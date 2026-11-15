import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, loadFixture } from '../../tests/helpers/fixtures';
import { VamError } from '@/lib/vam/client';

const cacheLife = vi.fn();
vi.mock('next/cache', () => ({ cacheLife: (profile: unknown) => cacheLife(profile) as unknown }));

const { cachedClient, cachedDesign, cachedPing, cachedSearch } = await import('./vam-cache');

afterEach(() => {
  vi.unstubAllGlobals();
  cacheLife.mockReset();
});

function stubFetch(body: unknown, status = 200) {
  const fetchFn = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(body, status)));
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
}

describe('cached functions return outcomes instead of throwing', () => {
  it('cachedSearch returns the result, asks the V&A once with a descriptive User-Agent, and caches for hours', async () => {
    const fetchFn = stubFetch(loadFixture('search-morris-wallpaper.json'));
    const outcome = await cachedSearch('indian', 2);
    expect(outcome.ok && outcome.value.items[0]?.systemNumber).toBe('O78207');
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).host).toBe('api.vam.ac.uk');
    expect(new URL(url).searchParams.get('page')).toBe('2');
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/^colourway-studio\/\S+ \(/);
    expect(cacheLife).toHaveBeenCalledWith('hours');
  });

  it('cachedDesign returns the design and caches for hours', async () => {
    const fetchFn = stubFetch(loadFixture('museumobject-O78207.json'));
    const outcome = await cachedDesign('O78207');
    expect(outcome.ok && outcome.value.title).toBe('Indian');
    expect(new URL(fetchFn.mock.calls[0]![0] as string).pathname).toBe('/v2/object/O78207');
    expect(cacheLife).toHaveBeenCalledWith('hours');
  });

  it('a missing design is a stable not_found outcome, cached for hours (so a loop of bad ids is cheap)', async () => {
    stubFetch({ detail: 'Object not found' }, 404);
    expect(await cachedDesign('O99999999')).toEqual({ ok: false, code: 'not_found', upstreamStatus: 404 });
    expect(cacheLife).toHaveBeenCalledWith('hours');
  });

  it('an upstream failure is an outcome too, cached only briefly', async () => {
    stubFetch({}, 503);
    const outcome = await cachedSearch('x', 1);
    expect(outcome).toMatchObject({ ok: false, code: 'upstream', upstreamStatus: 503 });
    expect(cacheLife).toHaveBeenCalledWith({ stale: 5, revalidate: 10, expire: 60 });
  });

  it('outcomes survive serialisation, which is what the cache boundary does to them', async () => {
    stubFetch({ detail: 'x' }, 404);
    const outcome = await cachedDesign('O1');
    expect(JSON.parse(JSON.stringify(outcome))).toEqual(outcome);
  });
});

describe('cachedClient turns outcomes back into the errors the handlers expect', () => {
  it('rejects with a real VamError not_found for a missing design', async () => {
    stubFetch({ detail: 'Object not found' }, 404);
    const error = await cachedClient.getDesign('O99999999').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VamError);
    expect(error).toMatchObject({ code: 'not_found', upstreamStatus: 404 });
  });

  it('rejects with VamError not_found for a design that has no image', async () => {
    stubFetch(loadFixture('object-no-images-O270961.json'));
    expect(await cachedClient.getDesign('O270961').catch((e: unknown) => e)).toMatchObject({ code: 'not_found' });
  });

  it('rejects with VamError upstream when the V&A is down', async () => {
    stubFetch({}, 503);
    const error = await cachedClient.searchDesigns({}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VamError);
    expect(error).toMatchObject({ code: 'upstream', upstreamStatus: 503 });
  });

  it('defaults to an empty query on page 1', async () => {
    const fetchFn = stubFetch(loadFixture('search-empty-result.json'));
    await cachedClient.searchDesigns({});
    const url = new URL(fetchFn.mock.calls[0]![0] as string);
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.has('q')).toBe(false);
  });

  it('resolves a design', async () => {
    stubFetch(loadFixture('museumobject-O78207.json'));
    expect((await cachedClient.getDesign('O78207')).systemNumber).toBe('O78207');
  });
});

describe('cachedPing', () => {
  it('is cached for 60 s and says when it checked', async () => {
    stubFetch(loadFixture('search-empty-result.json'));
    const ping = await cachedPing();
    expect(ping.reachable).toBe(true);
    expect(Number.isNaN(Date.parse(ping.checkedAt))).toBe(false);
    expect(cacheLife).toHaveBeenCalledWith({ stale: 60, revalidate: 60, expire: 300 });
  });

  it('reports unreachable instead of throwing', async () => {
    stubFetch({}, 503);
    expect((await cachedPing()).reachable).toBe(false);
  });
});
