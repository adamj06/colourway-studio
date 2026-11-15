import { cacheLife } from 'next/cache';
import { env } from '@/env';
import { createVamClient, type VamClient } from '@/lib/vam/client';
import { fromOutcome, isStable, toOutcome, type Outcome } from '@/lib/vam/outcome';
import type { Design, SearchResult } from '@/lib/vam/types';

// Next-specific caching around the pure V&A client (src/lib/vam stays free of framework imports).
//
// `use cache` is an in-memory cache: on Vercel's serverless runtime entries are best-effort and not shared between
// instances (node_modules/next/dist/docs/.../use-cache.md, "Runtime caching considerations"). The route handlers
// therefore ALSO send Cache-Control headers so Vercel's CDN is the shared cache. Both are documented in the runbook.
//
// Cached functions never throw: an error crossing the cache boundary loses its class (it became a 500 for every
// failure). They return an Outcome, and cachedClient turns it back into a VamError for the handlers.

const version = env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev';
const client = createVamClient({ userAgent: `colourway-studio/${version} (non-commercial case study)` });

/** Stable answers (results, "not found") live for hours; failures only for seconds, so an outage can't pin an error. */
function lifeFor(outcome: Outcome<unknown>): void {
  if (isStable(outcome)) cacheLife('hours');
  else cacheLife({ stale: 5, revalidate: 10, expire: 60 });
}

export async function cachedSearch(q: string, page: number): Promise<Outcome<SearchResult>> {
  'use cache';
  const outcome = await toOutcome(() => client.searchDesigns({ q, page }));
  lifeFor(outcome);
  return outcome;
}

export async function cachedDesign(systemNumber: string): Promise<Outcome<Design>> {
  'use cache';
  const outcome = await toOutcome(() => client.getDesign(systemNumber));
  lifeFor(outcome);
  return outcome;
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
  searchDesigns: async ({ q, page }) => fromOutcome(await cachedSearch(q ?? '', page ?? 1)),
  getDesign: async (systemNumber) => fromOutcome(await cachedDesign(systemNumber)),
};
