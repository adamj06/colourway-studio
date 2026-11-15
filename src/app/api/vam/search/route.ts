import { handleSearch } from '@/lib/api/handlers';
import { createLogger } from '@/lib/log/logger';
import { jsonResult } from '@/server/respond-json';
import { cachedClient } from '@/server/vam-cache';

const logger = createLogger({ route: '/api/vam/search' });

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  return jsonResult(await handleSearch(searchParams, { client: cachedClient, logger }));
}
