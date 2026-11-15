import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, loadFixture } from '../../tests/helpers/fixtures';
import { handleSearch } from './api/handlers';
import { fetchWithRetry } from './http/fetch-with-retry';
import { createLogger } from './log/logger';
import { createVamClient, VamError } from './vam/client';
import { htmlToText, mapObjectResponse, mapSearchResponse } from './vam/map';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('htmlToText entity edge cases', () => {
  it('decodes hex entities in either case and numeric ones', () => {
    expect(htmlToText('&#x41;&#X42;&#67;')).toBe('ABC');
  });

  it.each(['&#0;', '&#1114112;', '&#xFFFFFFFF;', '&nosuchentity;'])('leaves %s as literal text', (entity) => {
    expect(htmlToText(entity)).toBe(entity);
  });

  it.each(['&constructor;', '&toString;', '&__proto__;', '&hasOwnProperty;'])(
    'does not resolve %s through the object prototype',
    (entity) => {
      expect(htmlToText(entity)).toBe(entity);
    },
  );

  it('decodes &gt; &quot; and &apos;', () => {
    expect(htmlToText('&gt; &quot;x&quot; &apos;y&apos;')).toBe('> "x" \'y\'');
  });
});

describe('mappers with sparse records', () => {
  it('uses plain "Untitled" and an empty objectType for a search record with neither', () => {
    const raw = structuredClone(loadFixture('search-morris-wallpaper.json')) as { records: Record<string, unknown>[] };
    raw.records[0]!._primaryTitle = '';
    delete raw.records[0]!.objectType;
    const item = mapSearchResponse(raw).items[0]!;
    expect(item.title).toBe('Untitled');
    expect(item.objectType).toBe('');
  });

  it('uses plain "Untitled" and an empty objectType for a design with neither', () => {
    const raw = structuredClone(loadFixture('museumobject-O78207.json')) as { record: Record<string, unknown> };
    raw.record.titles = [];
    delete raw.record.objectType;
    const design = mapObjectResponse(raw)!;
    expect(design.title).toBe('Untitled');
    expect(design.objectType).toBe('');
  });

  it('returns null dimensions, materials and date when absent', () => {
    const raw = structuredClone(loadFixture('museumobject-O78207.json')) as { record: Record<string, unknown> };
    raw.record.dimensions = [];
    raw.record.materialsAndTechniques = '';
    raw.record.productionDates = [];
    const design = mapObjectResponse(raw)!;
    expect(design.dimensions).toBeNull();
    expect(design.materials).toBeNull();
    expect(design.date).toBeNull();
  });

  it('drops a record whose image base url is not on framemark', () => {
    const raw = structuredClone(loadFixture('search-morris-wallpaper.json')) as {
      records: { _images: Record<string, unknown> }[];
    };
    raw.records[0]!._images._iiif_image_base_url = 'https://evil.example/collections/X/';
    expect(mapSearchResponse(raw).items.map((i) => i.systemNumber)).not.toContain('O78207');
  });

  it('returns null for a design whose image base url is not on framemark', () => {
    const raw = structuredClone(loadFixture('museumobject-O78207.json')) as {
      meta: { images: Record<string, string> };
    };
    raw.meta.images._iiif_image = 'https://evil.example/collections/X/';
    expect(mapObjectResponse(raw)).toBeNull();
  });
});

describe('client edge cases', () => {
  it('uses the global fetch when none is injected', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(loadFixture('search-empty-result.json')));
    vi.stubGlobal('fetch', fetchFn);
    await createVamClient().searchDesigns({});
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('maps any other 4xx from the object endpoint to upstream with its status', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ detail: 'x' }, 422));
    const err = await createVamClient({ fetch: fetchFn as typeof fetch })
      .getDesign('O1')
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'upstream', upstreamStatus: 422 });
  });

  it('turns an unexpected non-upstream failure into invalid_response', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const sleep = vi.fn().mockRejectedValue(new Error('sleep exploded'));
    const err = await createVamClient({ fetch: fetchFn as typeof fetch, sleep })
      .searchDesigns({})
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VamError);
    expect(err).toMatchObject({ code: 'invalid_response' });
  });
});

describe('fetchWithRetry defaults', () => {
  it('works without injected sleep or headers, using the real (short) backoff', async () => {
    const fetchFn = vi.fn().mockRejectedValueOnce(new TypeError('x')).mockResolvedValueOnce(new Response('ok'));
    const res = await fetchWithRetry('https://api.vam.ac.uk/x', { fetch: fetchFn as typeof fetch, backoffMs: 1 });
    expect(res.status).toBe(200);
    expect((fetchFn.mock.calls[0]![1] as RequestInit).headers).toEqual({});
  });

  it('uses the global fetch when none is injected', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', fetchFn);
    await fetchWithRetry('https://api.vam.ac.uk/x');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('logger defaults', () => {
  it('writes one JSON line to the console with the real clock when no write or now is injected', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    createLogger({ route: '/api/x' }).info('hi');
    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0]![0] as string) as { ts: number; msg: string };
    expect(line.msg).toBe('hi');
    expect(typeof line.ts).toBe('number');
  });

  it('falls back to a minimal line if serialising throws', () => {
    const lines: string[] = [];
    const logger = createLogger({ route: '/r', write: (l) => lines.push(l), now: () => 1 });
    const hostile = {
      toJSON() {
        throw new Error('nope');
      },
    };
    logger.info('m', { hostile });
    expect(JSON.parse(lines[0]!)).toEqual({ level: 'info', msg: 'm', route: '/r', ts: 1 });
  });
});

describe('handler logging of non-Error throwables', () => {
  it('maps a thrown string to 500 and logs no errorName', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const out = await handleSearch(new URLSearchParams(''), {
      client: { searchDesigns: vi.fn().mockRejectedValue('boom') },
      logger,
    });
    expect(out.status).toBe(500);
    expect(logger.error.mock.calls[0]![1]).not.toHaveProperty('errorName');
  });
});
