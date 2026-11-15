import { describe, expect, it, vi } from 'vitest';
import { loadFixture } from '../../tests/helpers/fixtures';
import { fetchJsonWithRetry, UpstreamError } from './http/fetch-with-retry';
import { isDesign, isSearchResult } from './vam/guards';
import { htmlToText, mapObjectResponse, mapSearchResponse } from './vam/map';
import { isCollectionUrl, isSystemNumber } from './vam/urls';

const asFetch = (fn: unknown) => fn as typeof fetch;
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
const noSleep = () => Promise.resolve();

async function errorOf(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => undefined,
    (e: unknown) => e,
  );
}

describe('fetchJsonWithRetry', () => {
  it('returns status, ok and the parsed body for a JSON 200', async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ a: 1 }));
    expect(await fetchJsonWithRetry('https://api.vam.ac.uk/x', { fetch: asFetch(fetchFn), sleep: noSleep })).toEqual({
      status: 200,
      ok: true,
      body: { a: 1 },
    });
  });

  it('never follows redirects: it asks fetch not to', async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({}));
    await fetchJsonWithRetry('https://api.vam.ac.uk/x', { fetch: asFetch(fetchFn), sleep: noSleep });
    expect((fetchFn.mock.calls[0]![1] as RequestInit).redirect).toBe('manual');
  });

  it('returns a 3xx or 4xx as not ok without reading or retrying', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response('moved', { status: 302, headers: { location: 'https://evil.example' } }));
    const result = await fetchJsonWithRetry('https://api.vam.ac.uk/x', { fetch: asFetch(fetchFn), sleep: noSleep });
    expect(result).toEqual({ status: 302, ok: false, body: undefined });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('rejects a 200 that is not JSON, without retrying', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const err = await errorOf(
      fetchJsonWithRetry('https://api.vam.ac.uk/x', { fetch: asFetch(fetchFn), sleep: noSleep }),
    );
    expect(err).toMatchObject({ kind: 'invalid' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('rejects a 200 with no content-type', async () => {
    const response = new Response('{}', { status: 200 });
    response.headers.delete('content-type');
    const err = await errorOf(
      fetchJsonWithRetry('https://api.vam.ac.uk/x', {
        fetch: asFetch(vi.fn().mockResolvedValue(response)),
        sleep: noSleep,
      }),
    );
    expect(err).toBeInstanceOf(UpstreamError);
  });

  it('rejects a body that is not valid JSON', async () => {
    const response = new Response('{nope', { status: 200, headers: { 'content-type': 'application/json' } });
    const err = await errorOf(
      fetchJsonWithRetry('https://api.vam.ac.uk/x', {
        fetch: asFetch(vi.fn().mockResolvedValue(response)),
        sleep: noSleep,
      }),
    );
    expect(err).toMatchObject({ kind: 'invalid' });
  });

  it('rejects a declared content-length over the cap before reading', async () => {
    const response = json({ a: 1 }, { headers: { 'content-type': 'application/json', 'content-length': '999999' } });
    const err = await errorOf(
      fetchJsonWithRetry('https://api.vam.ac.uk/x', {
        fetch: asFetch(vi.fn().mockResolvedValue(response)),
        sleep: noSleep,
        maxBytes: 100,
      }),
    );
    expect(err).toMatchObject({ kind: 'invalid' });
  });

  it('stops reading a streamed body that grows past the cap', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(60));
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
      },
    });
    const response = new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    const err = await errorOf(
      fetchJsonWithRetry('https://api.vam.ac.uk/x', {
        fetch: asFetch(vi.fn().mockResolvedValue(response)),
        sleep: noSleep,
        maxBytes: 100,
      }),
    );
    expect(err).toMatchObject({ kind: 'invalid' });
  });

  it('accepts an empty body stream as invalid JSON', async () => {
    const response = new Response(null, { status: 200, headers: { 'content-type': 'application/json' } });
    const err = await errorOf(
      fetchJsonWithRetry('https://api.vam.ac.uk/x', {
        fetch: asFetch(vi.fn().mockResolvedValue(response)),
        sleep: noSleep,
      }),
    );
    expect(err).toMatchObject({ kind: 'invalid' });
  });

  it('times out when the headers arrive but the body stalls, then retries once', async () => {
    // Like a real fetch body: headers arrive, then the stream never produces data and errors when the signal aborts.
    const stalled = (signal: AbortSignal | null | undefined) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            signal?.addEventListener('abort', () => {
              controller.error(new DOMException('aborted', 'AbortError'));
            });
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    const fetchFn = vi
      .fn()
      .mockImplementation((_url: string, init: RequestInit) => Promise.resolve(stalled(init.signal)));
    const err = await errorOf(
      fetchJsonWithRetry('https://api.vam.ac.uk/x', { fetch: asFetch(fetchFn), sleep: noSleep, timeoutMs: 30 }),
    );
    expect(err).toMatchObject({ kind: 'timeout' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('retries a 5xx once and then reads the second body', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('x', { status: 503 }))
      .mockResolvedValueOnce(json({ ok: 1 }));
    const result = await fetchJsonWithRetry('https://api.vam.ac.uk/x', { fetch: asFetch(fetchFn), sleep: noSleep });
    expect(result.body).toEqual({ ok: 1 });
  });
});

describe('urls', () => {
  it.each(['O1', 'O78207', 'O1234567890'])('%s is a system number', (v) => {
    expect(isSystemNumber(v)).toBe(true);
  });

  it.each(['', '../x', 'O1/../..', 'o1', 'O12345678901', 'O1\n'])('%j is not a system number', (v) => {
    expect(isSystemNumber(v)).toBe(false);
  });

  it('accepts only https collections.vam.ac.uk links', () => {
    expect(isCollectionUrl('https://collections.vam.ac.uk/item/O78207/')).toBe(true);
    for (const bad of [
      'https://evil.example/',
      'http://collections.vam.ac.uk/item/O1/',
      'https://collections.vam.ac.uk.evil.com/',
      'https://user@collections.vam.ac.uk/',
      'https://collections.vam.ac.uk:8443/',
      'javascript:alert(1)',
      'not a url',
      '',
    ]) {
      expect(isCollectionUrl(bad), bad).toBe(false);
    }
  });
});

describe('mappers reject hostile upstream fields', () => {
  it('maps a collection url off the V&A to null, and isDesign rejects it', () => {
    const raw = structuredClone(loadFixture('museumobject-O78207.json')) as {
      meta: { _links: { collection_page: { href: string } } };
    };
    raw.meta._links.collection_page.href = 'https://evil.example/phish';
    expect(mapObjectResponse(raw)!.collectionUrl).toBeNull();
    const design = mapObjectResponse(loadFixture('museumobject-O78207.json'))!;
    expect(isDesign({ ...design, collectionUrl: 'https://evil.example/phish' })).toBe(false);
  });

  it('drops a search record and a design whose system number is not O + digits', () => {
    const search = structuredClone(loadFixture('search-morris-wallpaper.json')) as {
      records: { systemNumber: string }[];
    };
    search.records[0]!.systemNumber = '../x';
    expect(mapSearchResponse(search).items.map((i) => i.systemNumber)).not.toContain('../x');

    const object = structuredClone(loadFixture('museumobject-O78207.json')) as { record: { systemNumber: string } };
    object.record.systemNumber = 'O1/../..';
    expect(mapObjectResponse(object)).toBeNull();
  });

  it('isSearchResult and isDesign reject a bad system number', () => {
    const result = mapSearchResponse(loadFixture('search-morris-wallpaper.json'));
    expect(isSearchResult({ ...result, items: [{ ...result.items[0], systemNumber: '../x' }] })).toBe(false);
    const design = mapObjectResponse(loadFixture('museumobject-O78207.json'))!;
    expect(isDesign({ ...design, systemNumber: '../x' })).toBe(false);
  });

  it('rejects an upstream search page with more than 100 records', () => {
    const raw = structuredClone(loadFixture('search-morris-wallpaper.json')) as { records: unknown[] };
    raw.records = Array.from({ length: 101 }, () => raw.records[0]);
    expect(() => mapSearchResponse(raw)).toThrow();
  });
});

describe('htmlToText hardening', () => {
  it('keeps a bare "<" that is not a tag', () => {
    expect(htmlToText('a < b and 2<3')).toBe('a < b and 2<3');
  });

  it('keeps list items and blocks apart', () => {
    expect(htmlToText('<ul><li>a</li><li>b</li></ul>')).toBe('a\nb');
    expect(htmlToText('<div>one</div><div>two</div>')).toBe('one\ntwo');
  });

  it('decodes common typographic and accented entities', () => {
    expect(htmlToText('Caf&eacute; &rsquo;tis &mdash; fine&hellip; &copy; V&amp;A')).toBe('Café ’tis — fine… © V&A');
  });

  it('truncates absurdly long input instead of scanning it all', () => {
    const hostile = '<script '.repeat(50_000);
    const started = Date.now();
    htmlToText(hostile);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(htmlToText('x'.repeat(30_000)).length).toBe(20_000);
  });
});
