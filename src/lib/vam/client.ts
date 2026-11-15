import { fetchJsonWithRetry, UpstreamError, type JsonResult } from '../http/fetch-with-retry';
import { mapObjectResponse, mapSearchResponse } from './map';
import type { Design, SearchResult } from './types';

// The ONLY upstream host this client can talk to. Nothing a user supplies ever becomes a host or a path
// (docs/threat-model.md: hard allowlist, no SSRF): the object id is validated and q is only ever a query value.
const API_ORIGIN = 'https://api.vam.ac.uk';
// Morris & Co. (the organisation, so designs by Dearle and others are included, not just William Morris).
const MORRIS_AND_CO_ORG_ID = 'A1365';
const PAGE_SIZE = 24;
const SYSTEM_NUMBER = /^O\d{1,10}$/;
const DEFAULT_USER_AGENT = 'colourway-studio/0.1 (non-commercial case study)';

export type VamErrorCode = 'invalid_input' | 'not_found' | 'upstream' | 'timeout' | 'invalid_response';

export class VamError extends Error {
  readonly code: VamErrorCode;
  readonly upstreamStatus: number | undefined;

  constructor(code: VamErrorCode, message: string, upstreamStatus?: number) {
    super(message);
    this.name = 'VamError';
    this.code = code;
    this.upstreamStatus = upstreamStatus;
  }
}

/**
 * The search URL. The V&A silently ignores unknown parameters (a typo returns the whole collection with a 200),
 * so these exact names are pinned by tests and by the contract test.
 */
export function buildSearchUrl(params: {
  q?: string | undefined;
  page: number;
  pageSize?: number | undefined;
}): string {
  const url = new URL('/v2/objects/search', API_ORIGIN);
  url.searchParams.set('id_organisation', MORRIS_AND_CO_ORG_ID);
  url.searchParams.set('images_exist', '1');
  url.searchParams.set('page_size', String(params.pageSize ?? PAGE_SIZE));
  url.searchParams.set('page', String(params.page));
  const q = params.q?.trim();
  if (q) url.searchParams.set('q', q);
  return url.toString();
}

export function buildObjectUrl(systemNumber: string): string {
  if (!SYSTEM_NUMBER.test(systemNumber)) throw new VamError('invalid_input', 'Invalid system number');
  return new URL(`/v2/object/${systemNumber}`, API_ORIGIN).toString();
}

export type VamClientDeps = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  userAgent?: string;
  now?: () => number;
};

export type VamClient = {
  searchDesigns: (params: { q?: string | undefined; page?: number | undefined }) => Promise<SearchResult>;
  getDesign: (systemNumber: string) => Promise<Design>;
  ping: () => Promise<{ reachable: boolean; latencyMs: number }>;
};

function toVamError(error: unknown): VamError {
  if (error instanceof UpstreamError) {
    if (error.kind === 'timeout') return new VamError('timeout', 'The V&A API timed out');
    if (error.kind === 'invalid') return new VamError('invalid_response', 'The V&A API sent an unacceptable response');
    return new VamError('upstream', 'The V&A API is unavailable', error.status);
  }
  return new VamError('invalid_response', 'Unexpected response from the V&A API');
}

export function createVamClient(deps: VamClientDeps = {}): VamClient {
  const now = deps.now ?? Date.now;
  const headers = { 'User-Agent': deps.userAgent ?? DEFAULT_USER_AGENT, Accept: 'application/json' };

  // The 5 s timeout covers the body as well as the headers, the body is size-capped and must be JSON.
  const request = async (url: string): Promise<JsonResult> => {
    try {
      return await fetchJsonWithRetry(url, {
        headers,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        ...(deps.sleep ? { sleep: deps.sleep } : {}),
      });
    } catch (error) {
      throw toVamError(error);
    }
  };

  const parse = <T>(map: () => T): T => {
    try {
      return map();
    } catch {
      throw new VamError('invalid_response', 'The V&A API response did not match the expected shape');
    }
  };

  return {
    async searchDesigns({ q, page = 1 }) {
      const response = await request(buildSearchUrl({ q, page }));
      if (!response.ok) throw new VamError('upstream', 'The V&A API rejected the search', response.status);
      return parse(() => mapSearchResponse(response.body));
    },

    async getDesign(systemNumber) {
      const response = await request(buildObjectUrl(systemNumber));
      if (response.status === 404) throw new VamError('not_found', 'Design not found', 404);
      if (!response.ok) throw new VamError('upstream', 'The V&A API rejected the request', response.status);
      const design = parse(() => mapObjectResponse(response.body));
      if (design === null) throw new VamError('not_found', 'Design has no image', 404);
      return design;
    },

    async ping() {
      const started = now();
      let reachable = false;
      try {
        reachable = (await request(buildSearchUrl({ page: 1, pageSize: 1 }))).ok;
      } catch {
        reachable = false;
      }
      return { reachable, latencyMs: now() - started };
    },
  };
}
