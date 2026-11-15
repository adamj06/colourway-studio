import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, loadFixture } from '../../tests/helpers/fixtures';

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

describe('vam-cache', () => {
  it('cachedSearch asks the V&A once, with a descriptive User-Agent, and caches for hours', async () => {
    const fetchFn = stubFetch(loadFixture('search-morris-wallpaper.json'));
    const result = await cachedSearch('indian', 2);
    expect(result.items[0]?.systemNumber).toBe('O78207');
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).host).toBe('api.vam.ac.uk');
    expect(new URL(url).searchParams.get('page')).toBe('2');
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/^colourway-studio\/\S+ \(/);
    expect(cacheLife).toHaveBeenCalledWith('hours');
  });

  it('cachedDesign fetches one object and caches for hours', async () => {
    const fetchFn = stubFetch(loadFixture('museumobject-O78207.json'));
    const design = await cachedDesign('O78207');
    expect(design.title).toBe('Indian');
    expect(new URL(fetchFn.mock.calls[0]![0] as string).pathname).toBe('/v2/object/O78207');
    expect(cacheLife).toHaveBeenCalledWith('hours');
  });

  it('cachedPing is cached for 60 s and says when it checked', async () => {
    stubFetch(loadFixture('search-empty-result.json'));
    const ping = await cachedPing();
    expect(ping.reachable).toBe(true);
    expect(Number.isNaN(Date.parse(ping.checkedAt))).toBe(false);
    expect(cacheLife).toHaveBeenCalledWith({ stale: 60, revalidate: 60, expire: 300 });
  });

  it('cachedPing reports unreachable instead of throwing', async () => {
    stubFetch({}, 503);
    expect((await cachedPing()).reachable).toBe(false);
  });

  it('cachedClient defaults to an empty query on page 1', async () => {
    const fetchFn = stubFetch(loadFixture('search-empty-result.json'));
    await cachedClient.searchDesigns({});
    const url = new URL(fetchFn.mock.calls[0]![0] as string);
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.has('q')).toBe(false);
  });

  it('cachedClient.getDesign delegates to the cached design lookup', async () => {
    stubFetch(loadFixture('museumobject-O78207.json'));
    expect((await cachedClient.getDesign('O78207')).systemNumber).toBe('O78207');
  });
});
