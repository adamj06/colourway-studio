import type { HandlerResult } from '@/lib/api/handlers';

// Shared CDN cache for successful reads. Vercel's CDN is the cache that actually persists between serverless
// instances; stale-while-revalidate keeps pages instant while they refresh. Errors are never cached.
const CACHE_OK = 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400';
const CACHE_NONE = 'no-store';

export function jsonResult(result: HandlerResult, cacheControl: string = CACHE_OK): Response {
  const ok = result.status >= 200 && result.status < 300;
  return Response.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': ok ? cacheControl : CACHE_NONE },
  });
}
