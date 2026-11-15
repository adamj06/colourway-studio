import { describe, expect, it, vi } from 'vitest';
import { jsonResponse, loadFixture } from '../../../tests/helpers/fixtures';
import { buildObjectUrl, buildSearchUrl, createVamClient, VamError } from './client';

const asFetch = (fn: unknown) => fn as typeof fetch;
const noSleep = () => Promise.resolve();

function clientWith(fetchFn: unknown, extra: { now?: () => number; userAgent?: string } = {}) {
  return createVamClient({ fetch: asFetch(fetchFn), sleep: noSleep, ...extra });
}

async function errorOf(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => undefined,
    (e: unknown) => e,
  );
}

describe('buildSearchUrl', () => {
  it('targets https://api.vam.ac.uk/v2/objects/search', () => {
    const url = new URL(buildSearchUrl({ page: 1 }));
    expect(url.protocol).toBe('https:');
    expect(url.host).toBe('api.vam.ac.uk');
    expect(url.pathname).toBe('/v2/objects/search');
  });

  it('uses the exact param names and values for the org filter, images, page size and page', () => {
    const sp = new URL(buildSearchUrl({ page: 3 })).searchParams;
    expect(sp.get('id_organisation')).toBe('A1365');
    expect(sp.get('images_exist')).toBe('1');
    expect(sp.get('page_size')).toBe('24');
    expect(sp.get('page')).toBe('3');
    expect([...sp.keys()].sort()).toEqual(['id_organisation', 'images_exist', 'page', 'page_size']);
  });

  it('adds q when given', () => {
    const sp = new URL(buildSearchUrl({ q: 'strawberry', page: 1 })).searchParams;
    expect(sp.get('q')).toBe('strawberry');
  });

  it.each(['', '   ', '\t\n'])('omits q when it is blank (%j)', (q) => {
    expect(new URL(buildSearchUrl({ q, page: 1 })).searchParams.has('q')).toBe(false);
  });

  it('trims q', () => {
    expect(new URL(buildSearchUrl({ q: '  fruit  ', page: 1 })).searchParams.get('q')).toBe('fruit');
  });

  it('url-encodes an injection attempt so it stays inside the q value', () => {
    const built = buildSearchUrl({ q: 'a&id_organisation=X', page: 1 });
    const sp = new URL(built).searchParams;
    expect(sp.get('q')).toBe('a&id_organisation=X');
    expect(sp.getAll('id_organisation')).toEqual(['A1365']);
    expect(built).not.toContain('q=a&id_organisation=X');
  });

  it('keeps path traversal text inside q and the path unchanged', () => {
    const url = new URL(buildSearchUrl({ q: '../..', page: 1 }));
    expect(url.pathname).toBe('/v2/objects/search');
    expect(url.searchParams.get('q')).toBe('../..');
  });

  it('round-trips unicode q', () => {
    const q = 'Fraise été モリス 🍓';
    expect(new URL(buildSearchUrl({ q, page: 1 })).searchParams.get('q')).toBe(q);
  });
});

describe('buildObjectUrl', () => {
  it('builds https://api.vam.ac.uk/v2/object/<id>', () => {
    const url = new URL(buildObjectUrl('O78207'));
    expect(url.protocol).toBe('https:');
    expect(url.host).toBe('api.vam.ac.uk');
    expect(url.pathname).toBe('/v2/object/O78207');
    expect(url.search).toBe('');
  });

  it('accepts O plus 1 to 10 digits', () => {
    expect(() => buildObjectUrl('O1')).not.toThrow();
    expect(() => buildObjectUrl('O1234567890')).not.toThrow();
  });

  it.each([
    '../objects/search',
    'O1/../x',
    'O1?x=1',
    'O1#x',
    'o1',
    'O',
    'O12345678901',
    ' O1',
    'O1 ',
    'O1\n',
    'O-1',
    '',
    'P1',
    'O1/',
    '%2e%2e',
  ])('rejects %j with VamError invalid_input', (id) => {
    let caught: unknown;
    try {
      buildObjectUrl(id);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(VamError);
    expect((caught as VamError).code).toBe('invalid_input');
  });
});

describe('createVamClient.searchDesigns', () => {
  it('requests the built search url and maps the response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(loadFixture('search-morris-wallpaper.json')));
    const result = await clientWith(fetchFn).searchDesigns({ q: 'indian', page: 1 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]![0]).toBe(buildSearchUrl({ q: 'indian', page: 1 }));
    expect(result.items[0]!.systemNumber).toBe('O78207');
    expect(result.total).toBe(626);
  });

  it('defaults to page 1 and no q', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(loadFixture('search-org-A1365-images-p1.json')));
    await clientWith(fetchFn).searchDesigns({});
    expect(fetchFn.mock.calls[0]![0]).toBe(buildSearchUrl({ page: 1 }));
  });

  it('sends a User-Agent starting with colourway-studio/ by default', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(loadFixture('search-empty-result.json')));
    await clientWith(fetchFn).searchDesigns({});
    const init = fetchFn.mock.calls[0]![1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('user-agent')).toMatch(/^colourway-studio\//);
  });

  it('uses a custom user agent when given', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(loadFixture('search-empty-result.json')));
    await clientWith(fetchFn, { userAgent: 'custom-agent/9' }).searchDesigns({});
    const init = fetchFn.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get('user-agent')).toBe('custom-agent/9');
  });

  it('returns an empty page for a page past the end', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(loadFixture('search-empty-result.json')));
    const result = await clientWith(fetchFn).searchDesigns({ page: 100 });
    expect(result).toMatchObject({ items: [], totalPages: 0, page: 100 });
  });

  it.each([404, 422, 400])('maps an upstream %i to VamError upstream with the status', async (status) => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ detail: 'x' }, status));
    const err = await errorOf(clientWith(fetchFn).searchDesigns({}));
    expect(err).toBeInstanceOf(VamError);
    expect(err).toMatchObject({ code: 'upstream', upstreamStatus: status });
  });

  it('maps a 5xx that persists after the retry to upstream', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, 503));
    const err = await errorOf(clientWith(fetchFn).searchDesigns({}));
    expect(err).toMatchObject({ code: 'upstream', upstreamStatus: 503 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('retries once on a network error and succeeds', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse(loadFixture('search-empty-result.json')));
    const result = await clientWith(fetchFn).searchDesigns({});
    expect(result.items).toEqual([]);
  });

  it('maps a persistent network failure to VamError upstream', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const err = await errorOf(clientWith(fetchFn).searchDesigns({}));
    expect(err).toMatchObject({ code: 'upstream' });
  });

  it('maps a timeout to VamError timeout', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));
    const err = await errorOf(clientWith(fetchFn).searchDesigns({}));
    expect(err).toBeInstanceOf(VamError);
    expect((err as VamError).code).toBe('timeout');
  });

  it('maps invalid JSON to invalid_response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('<html>oops</html>', { status: 200 }));
    const err = await errorOf(clientWith(fetchFn).searchDesigns({}));
    expect(err).toMatchObject({ code: 'invalid_response' });
  });

  it('maps a schema mismatch to invalid_response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ info: {}, records: 'nope' }));
    const err = await errorOf(clientWith(fetchFn).searchDesigns({}));
    expect(err).toMatchObject({ code: 'invalid_response' });
  });
});

describe('createVamClient.getDesign', () => {
  it('requests the object url and maps the design', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(loadFixture('museumobject-O78207.json')));
    const design = await clientWith(fetchFn).getDesign('O78207');
    expect(fetchFn.mock.calls[0]![0]).toBe(buildObjectUrl('O78207'));
    expect(design.title).toBe('Indian');
  });

  it('maps a 404 to VamError not_found', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ detail: 'Object not found' }, 404));
    const err = await errorOf(clientWith(fetchFn).getDesign('O99999999'));
    expect(err).toBeInstanceOf(VamError);
    expect(err).toMatchObject({ code: 'not_found' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('treats a design with no images as not_found', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(loadFixture('object-no-images-O270961.json')));
    const err = await errorOf(clientWith(fetchFn).getDesign('O270961'));
    expect(err).toMatchObject({ code: 'not_found' });
  });

  it('rejects an invalid id with invalid_input before any request is made', async () => {
    const fetchFn = vi.fn();
    const err = await errorOf(clientWith(fetchFn).getDesign('../objects/search'));
    expect(err).toMatchObject({ code: 'invalid_input' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('maps a 5xx after retry to upstream', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    const err = await errorOf(clientWith(fetchFn).getDesign('O78207'));
    expect(err).toMatchObject({ code: 'upstream', upstreamStatus: 500 });
  });

  it('maps a schema mismatch to invalid_response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ record: 7 }));
    const err = await errorOf(clientWith(fetchFn).getDesign('O78207'));
    expect(err).toMatchObject({ code: 'invalid_response' });
  });
});

describe('createVamClient.ping', () => {
  it('is reachable on a 200 and only touches api.vam.ac.uk', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(loadFixture('search-empty-result.json')));
    const result = await clientWith(fetchFn).ping();
    expect(result.reachable).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = new URL(fetchFn.mock.calls[0]![0] as string);
    expect(url.host).toBe('api.vam.ac.uk');
    expect(url.searchParams.get('page_size')).toBe('1');
    expect(url.searchParams.get('images_exist')).toBe('1');
  });

  it('computes latencyMs from the injected clock', async () => {
    const times = [1000, 1250];
    const now = () => times.shift() ?? 9999;
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(loadFixture('search-empty-result.json')));
    const result = await clientWith(fetchFn, { now }).ping();
    expect(result.latencyMs).toBe(250);
  });

  it('reports unreachable without throwing on a network failure', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const result = await clientWith(fetchFn).ping();
    expect(result.reachable).toBe(false);
    expect(typeof result.latencyMs).toBe('number');
  });

  it('reports unreachable on a persistent 5xx', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, 503));
    expect((await clientWith(fetchFn).ping()).reachable).toBe(false);
  });

  it('reports unreachable on a 4xx', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, 422));
    expect((await clientWith(fetchFn).ping()).reachable).toBe(false);
  });
});
