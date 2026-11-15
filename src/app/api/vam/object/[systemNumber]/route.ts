import { handleObject } from '@/lib/api/handlers';
import { createLogger } from '@/lib/log/logger';
import { jsonResult } from '@/server/respond-json';
import { cachedClient } from '@/server/vam-cache';

const logger = createLogger({ route: '/api/vam/object/[systemNumber]' });

export async function GET(
  _request: Request,
  { params }: RouteContext<'/api/vam/object/[systemNumber]'>,
): Promise<Response> {
  const { systemNumber } = await params;
  return jsonResult(await handleObject(systemNumber, { client: cachedClient, logger }));
}
