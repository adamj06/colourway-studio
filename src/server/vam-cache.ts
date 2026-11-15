import { cacheLife } from 'next/cache';
import { env } from '@/env';
import { createVamClient, VamError, type VamClient } from '@/lib/vam/client';
import { cacheable, decodeFailure, fromCacheable, type Cacheable } from '@/lib/vam/outcome';
import type { Design, SearchResult } from '@/lib/vam/types';

// Next-specific caching around the pure V&A client (src/lib/vam stays free of framework imports).
//
// `use cache` is an in-memory cache: on Vercel's serverless runtime entries are best-effort and not shared between
// instances (node_modules/next/dist/docs/.../use-cache.md, "Runtime caching considerations"). The route handlers
// therefore ALSO send Cache-Control headers so Vercel's CDN is the shared cache. Both are documented in the runbook.
//
// Cache policy (see src/lib/vam/outcome.ts): only successes and genuine not-found answers are returned, and so
// cached. Transient failures (5xx, timeout, network, bad body) THROW inside the cached function, so nothing is
// stored and a failed revalidation can't overwrite a good entry. The thrown error carries its code in `digest`
// (the class doesn't survive the boundary) and cachedClient rebuilds a VamError outside the cache.

const version = env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev';
const client = createVamClient({ userAgent: `colourway-studio/${version} (non-commercial case study)` });

export async function cachedSearch(q: string, page: number): Promise<Cacheable<SearchResult>> {
  'use cache';
  // The lifetime is set only after the work succeeded: a failure throws first and so is never given one.
  const result = await cacheable(() => client.searchDesigns({ q, page }));
  cacheLife('hours');
  return result;
}

export async function cachedDesign(systemNumber: string): Promise<Cacheable<Design>> {
  'use cache';
  const result = await cacheable(() => client.getDesign(systemNumber));
  cacheLife('hours');
  return result;
}

export async function cachedPing() {
  'use cache';
  // The /api/health reachability check hits the V&A at most once a minute, however often health is polled.
  cacheLife({ stale: 60, revalidate: 60, expire: 300 });
  const result = await client.ping();
  return { ...result, checkedAt: new Date().toISOString() };
}

/** The cached V&A client the route handlers use. Same interface as the pure client, so handlers are unchanged. */
export const cachedClient: Pick<VamClient, 'searchDesigns' | 'getDesign'> = {
  searchDesigns: async ({ q, page }) => {
    try {
      return fromCacheable(await cachedSearch(q ?? '', page ?? 1));
    } catch (error) {
      throw asVamError(error);
    }
  },
  getDesign: async (systemNumber) => {
    try {
      return fromCacheable(await cachedDesign(systemNumber));
    } catch (error) {
      throw asVamError(error);
    }
  },
};

/** A VamError from fromCacheable (not found) passes through; anything from the cache boundary is decoded. */
function asVamError(error: unknown): VamError {
  return error instanceof VamError ? error : decodeFailure(error);
}
