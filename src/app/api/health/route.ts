import { env } from '@/env';
import { handleHealth } from '@/lib/api/handlers';
import { jsonResult } from '@/server/respond-json';
import { cachedPing } from '@/server/vam-cache';

// The version is always live. Only the V&A reachability check is cached (60 s, see cachedPing), so polling this
// endpoint can't be used to hammer the V&A. The CDN also holds the response for 60 s.
export async function GET(): Promise<Response> {
  const result = await handleHealth({ client: { ping: cachedPing }, version: env.VERCEL_GIT_COMMIT_SHA });
  return jsonResult(result, 'public, max-age=0, s-maxage=60');
}
