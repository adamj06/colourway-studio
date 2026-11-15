import { cacheLife } from 'next/cache';
import { env } from '@/env';
import { createVamClient, type VamClient } from '@/lib/vam/client';

// Next-specific caching around the pure V&A client (src/lib/vam stays free of framework imports).
//
// `use cache` is an in-memory cache: on Vercel's serverless runtime entries are best-effort and not shared between
// instances (node_modules/next/dist/docs/.../use-cache.md, "Runtime caching considerations"). The route handlers
// therefore ALSO send Cache-Control headers so Vercel's CDN is the shared cache. Both are documented in the runbook.

const version = env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev';
const client = createVamClient({ userAgent: `colourway-studio/${version} (non-commercial case study)` });

export async function cachedSearch(q: string, page: number) {
  'use cache';
  // Stale-while-revalidate: serve the cached page instantly, refresh in the background after an hour,
  // and keep it for a day. A failed refresh throws, which leaves the last good entry in place.
  cacheLife('hours');
  return client.searchDesigns({ q, page });
}

export async function cachedDesign(systemNumber: string) {
  'use cache';
  cacheLife('hours');
  return client.getDesign(systemNumber);
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
  searchDesigns: ({ q, page }) => cachedSearch(q ?? '', page ?? 1),
  getDesign: (systemNumber) => cachedDesign(systemNumber),
};
