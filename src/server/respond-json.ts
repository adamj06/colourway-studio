import type { HandlerResult } from '@/lib/api/handlers';

// Shared CDN cache. Vercel's CDN is the cache that actually persists between serverless instances; stale-while-
// revalidate keeps pages instant while they refresh.
const CACHE_OK = 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400';
// A design that doesn't exist stays that way, so cache the 404 for a few minutes: a loop of made-up ids then costs
// one V&A call per id per 5 minutes instead of one per request.
const CACHE_NOT_FOUND = 'public, max-age=60, s-maxage=300';
// Upstream failures are cached for seconds only: long enough to stop a thundering herd, short enough to recover.
const CACHE_UPSTREAM_FAILURE = 'public, max-age=0, s-maxage=10';
const CACHE_NONE = 'no-store';

function cacheControlFor(status: number, ok: string): string {
  if (status >= 200 && status < 300) return ok;
  if (status === 404) return CACHE_NOT_FOUND;
  if (status === 502 || status === 504) return CACHE_UPSTREAM_FAILURE;
  return CACHE_NONE;
}

export function jsonResult(result: HandlerResult, cacheControl: string = CACHE_OK): Response {
  return Response.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': cacheControlFor(result.status, cacheControl) },
  });
}
