import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, loadFixture } from '../../tests/helpers/fixtures';
import { VamError } from '@/lib/vam/client';
import { decodeFailure, fromCacheable } from '@/lib/vam/outcome';

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

function rejectingFetch(error: Error) {
  const fetchFn = vi.fn().mockImplementation(() => Promise.reject(error));
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
}

const digestOf = (error: unknown): unknown => (error as { digest?: unknown }).digest;

/** Resolves with the rejection reason, or fails the test if the promise resolved. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

/** Each transient failure mode, set up through the stubbed global fetch. */
const FAILURES = [
  ['a 503', 'upstream', () => stubFetch({}, 503)],
  ['a timeout', 'timeout', () => rejectingFetch(new DOMException('aborted', 'AbortError'))],
  ['a network error', 'upstream', () => rejectingFetch(new TypeError('fetch failed'))],
  ['an invalid body', 'invalid_response', () => stubFetch({ unexpected: 'shape' })],
] as const;

describe('cached functions cache successes and genuine not-found only', () => {
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

  it('a missing design is a not_found outcome, cached for hours (so a loop of bad ids is cheap)', async () => {
    stubFetch({ detail: 'Object not found' }, 404);
    expect(await cachedDesign('O99999999')).toEqual({ ok: false, code: 'not_found', upstreamStatus: 404 });
    expect(cacheLife).toHaveBeenCalledWith('hours');
  });

  it('outcomes survive serialisation, which is what the cache boundary does to them', async () => {
    stubFetch({ detail: 'x' }, 404);
    const outcome = await cachedDesign('O1');
    expect(JSON.parse(JSON.stringify(outcome))).toEqual(outcome);
  });

  describe.each(FAILURES)('when the V&A gives %s', (_name, code, setup) => {
    it(`cachedSearch rejects with a digest that decodes to ${code} and is never given a lifetime`, async () => {
      setup();
      const error = await rejection(cachedSearch('x', 1));
      expect(decodeFailure(error).code).toBe(code);
      expect(typeof digestOf(error)).toBe('string');
      expect(cacheLife).not.toHaveBeenCalled();
    });

    it(`cachedDesign rejects with a digest that decodes to ${code} and is never given a lifetime`, async () => {
      setup();
      const error = await rejection(cachedDesign('O78207'));
      expect(decodeFailure(error).code).toBe(code);
      expect(typeof digestOf(error)).toBe('string');
      expect(cacheLife).not.toHaveBeenCalled();
    });
  });

  it('a 503 digest carries the upstream status', async () => {
    stubFetch({}, 503);
    expect(digestOf(await rejection(cachedSearch('x', 1)))).toBe('vam:upstream:503');
  });

  it('a failure does not leak upstream detail in the thrown message', async () => {
    rejectingFetch(new TypeError('sk-secret connection detail'));
    const error = (await rejection(cachedSearch('x', 1))) as Error;
    expect(error.message).not.toContain('sk-secret');
  });
});

describe('cachedClient turns outcomes and digests back into the errors the handlers expect', () => {
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

  it('rejects with a real VamError upstream 503 when the V&A is down (search)', async () => {
    stubFetch({}, 503);
    const error = await cachedClient.searchDesigns({}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VamError);
    expect(error).toMatchObject({ code: 'upstream', upstreamStatus: 503 });
  });

  it('rejects with a real VamError upstream 503 when the V&A is down (design)', async () => {
    stubFetch({}, 503);
    const error = await cachedClient.getDesign('O78207').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VamError);
    expect(error).toMatchObject({ code: 'upstream', upstreamStatus: 503 });
  });

  it('rejects with a real VamError timeout when the request is aborted', async () => {
    rejectingFetch(new DOMException('aborted', 'AbortError'));
    const error = await cachedClient.searchDesigns({ q: 'x' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VamError);
    expect(error).toMatchObject({ code: 'timeout' });
  });

  it('rejects with a real VamError invalid_response for a body of the wrong shape', async () => {
    stubFetch({ unexpected: 'shape' });
    const error = await cachedClient.searchDesigns({}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VamError);
    expect(error).toMatchObject({ code: 'invalid_response' });
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

// POLICY SIMULATION, NOT a real `use cache` test: Next's cache cannot run under Vitest. This tiny memo mimics the
// documented policy (store only resolved values; a throw leaves the previous entry untouched) to show that the
// "good, then failure, then good" sequence keeps serving the good entry. Real behaviour needs an e2e/prod check.
describe('policy simulation (not a real use-cache test): a failed revalidation keeps the previous entry', () => {
  function memoStoringOnlyResolved<T>(work: () => Promise<T>) {
    let entry: { value: T } | undefined;
    return {
      revalidate: async () => {
        try {
          entry = { value: await work() };
        } catch {
          // a throw leaves `entry` as it was
        }
      },
      read: () => entry?.value,
    };
  }

  it('serves the good entry through a transient failure, then the fresh one once the V&A recovers', async () => {
    const setups = [
      () => stubFetch(loadFixture('museumobject-O78207.json')),
      () => stubFetch({}, 503),
      () => stubFetch(loadFixture('museumobject-O78207.json')),
    ];
    let step = 0;
    const memo = memoStoringOnlyResolved(async () => {
      setups[step++]!();
      return fromCacheable(await cachedDesign('O78207'));
    });

    await memo.revalidate();
    expect(memo.read()?.title).toBe('Indian');

    await memo.revalidate();
    expect(memo.read()?.title).toBe('Indian');

    await memo.revalidate();
    expect(memo.read()?.systemNumber).toBe('O78207');
    expect(step).toBe(3);
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
