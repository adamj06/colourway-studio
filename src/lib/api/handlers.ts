import type { Logger } from '../log/logger';
import type { VamClient } from '../vam/client';
import { VamError } from '../vam/client';
import { parseSearchParams, parseSystemNumber } from './params';
import { errorBody, vamErrorToResponse } from './respond';

export type HandlerResult = { status: number; body: unknown };

type Deps<K extends keyof VamClient> = {
  client: Pick<VamClient, K>;
  logger: Logger;
  now?: () => number;
};

/** Runs `work`, then logs one structured line and returns the HTTP result. Failures are mapped to typed errors. */
async function run(deps: { logger: Logger; now?: () => number }, work: () => Promise<unknown>): Promise<HandlerResult> {
  const now = deps.now ?? Date.now;
  const started = now();
  try {
    const body = await work();
    deps.logger.info('request ok', { status: 200, durationMs: now() - started });
    return { status: 200, body };
  } catch (error) {
    const { status, body } = vamErrorToResponse(error);
    const upstreamStatus = error instanceof VamError ? error.upstreamStatus : undefined;
    deps.logger.error('request failed', {
      status,
      durationMs: now() - started,
      ...(upstreamStatus === undefined ? {} : { upstreamStatus }),
      ...(error instanceof Error ? { errorName: error.name } : {}),
    });
    return { status, body };
  }
}

export async function handleSearch(sp: URLSearchParams, deps: Deps<'searchDesigns'>): Promise<HandlerResult> {
  const params = parseSearchParams(sp);
  if (!params.ok) {
    deps.logger.warn('bad request', { status: 400 });
    return { status: 400, body: errorBody('invalid_input', params.message) };
  }
  return run(deps, () => deps.client.searchDesigns(params.value));
}

export async function handleObject(rawSystemNumber: string, deps: Deps<'getDesign'>): Promise<HandlerResult> {
  const systemNumber = parseSystemNumber(rawSystemNumber);
  if (!systemNumber.ok) {
    deps.logger.warn('bad request', { status: 400 });
    return { status: 400, body: errorBody('invalid_input', systemNumber.message) };
  }
  return run(deps, () => deps.client.getDesign(systemNumber.value));
}

/** Always 200: the app is up even when the V&A isn't. Reachability is reported, not enforced. */
export async function handleHealth(deps: {
  /** `checkedAt` is set by a caching ping so the body says when the V&A was actually checked, not when served. */
  client: { ping: () => Promise<{ reachable: boolean; latencyMs: number; checkedAt?: string }> };
  version: string | undefined;
  now?: () => number;
}): Promise<HandlerResult> {
  const now = deps.now ?? Date.now;
  const ping = await deps.client.ping().catch(() => ({ reachable: false, latencyMs: 0, checkedAt: undefined }));
  return {
    status: 200,
    body: {
      version: deps.version ?? 'dev',
      vam: {
        reachable: ping.reachable,
        latencyMs: ping.latencyMs,
        checkedAt: ping.checkedAt ?? new Date(now()).toISOString(),
      },
    },
  };
}
