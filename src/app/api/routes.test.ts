import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFixture } from '../../../tests/helpers/fixtures';
import { VamError } from '@/lib/vam/client';
import { mapObjectResponse, mapSearchResponse } from '@/lib/vam/map';

const cachedSearch = vi.fn();
const cachedDesign = vi.fn();
const cachedPing = vi.fn();

vi.mock('@/server/vam-cache', () => ({
  cachedClient: {
    searchDesigns: (p: { q?: string; page?: number }) => cachedSearch(p.q ?? '', p.page ?? 1) as unknown,
    getDesign: (id: string) => cachedDesign(id) as unknown,
  },
  cachedPing: () => cachedPing() as unknown,
}));

const { GET: searchGET } = await import('./vam/search/route');
const { GET: objectGET } = await import('./vam/object/[systemNumber]/route');
const { GET: healthGET } = await import('./health/route');

const OK_CACHE = 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400';

beforeEach(() => {
  cachedSearch.mockReset();
  cachedDesign.mockReset();
  cachedPing.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('GET /api/vam/search', () => {
  it('returns the mapped result with CDN cache headers', async () => {
    cachedSearch.mockResolvedValue(mapSearchResponse(loadFixture('search-morris-wallpaper.json')));
    const res = await searchGET(new Request('http://localhost/api/vam/search?q=indian&page=2'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(OK_CACHE);
    expect(cachedSearch).toHaveBeenCalledWith('indian', 2);
    const body = (await res.json()) as { items: { systemNumber: string }[] };
    expect(body.items[0]!.systemNumber).toBe('O78207');
  });

  it('answers 400 typed JSON, uncached, and never calls the V&A for a bad page', async () => {
    const res = await searchGET(new Request('http://localhost/api/vam/search?page=0'));
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ error: { code: 'invalid_input' } });
    expect(cachedSearch).not.toHaveBeenCalled();
  });

  it('answers 502 typed JSON, uncached, when the V&A fails', async () => {
    cachedSearch.mockRejectedValue(new VamError('upstream', 'secret detail', 503));
    const res = await searchGET(new Request('http://localhost/api/vam/search'));
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(await res.json())).not.toContain('secret detail');
  });
});

describe('GET /api/vam/object/[systemNumber]', () => {
  const ctx = (systemNumber: string) => ({ params: Promise.resolve({ systemNumber }) });

  it('returns the design', async () => {
    cachedDesign.mockResolvedValue(mapObjectResponse(loadFixture('museumobject-O78207.json')));
    const res = await objectGET(new Request('http://localhost/x'), ctx('O78207'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(OK_CACHE);
    expect(cachedDesign).toHaveBeenCalledWith('O78207');
  });

  it('answers 400 for a malformed id without calling the V&A', async () => {
    const res = await objectGET(new Request('http://localhost/x'), ctx('../objects/search'));
    expect(res.status).toBe(400);
    expect(cachedDesign).not.toHaveBeenCalled();
  });

  it('answers 404 typed JSON for an unknown design', async () => {
    cachedDesign.mockRejectedValue(new VamError('not_found', 'nope', 404));
    const res = await objectGET(new Request('http://localhost/x'), ctx('O99999999'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } });
  });
});

describe('GET /api/health', () => {
  it('reports version and V&A reachability, cached at the CDN for 60 s only', async () => {
    cachedPing.mockResolvedValue({ reachable: true, latencyMs: 90, checkedAt: '2026-11-15T12:00:00.000Z' });
    const res = await healthGET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=60');
    expect(await res.json()).toEqual({
      version: expect.any(String) as string,
      vam: { reachable: true, latencyMs: 90, checkedAt: '2026-11-15T12:00:00.000Z' },
    });
  });

  it('stays 200 and reports unreachable when the ping fails', async () => {
    cachedPing.mockRejectedValue(new Error('down'));
    const res = await healthGET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ vam: { reachable: false } });
  });
});
