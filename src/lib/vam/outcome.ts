import { VamError, type VamErrorCode } from './client';

// Cache policy for `use cache` functions: cache successes and genuine not-found answers ONLY.
//
// A transient failure (5xx, timeout, network, bad body) must never become a cached value, or a failed revalidation
// would overwrite a good entry and defeat serve-stale. So those THROW inside the cached function: nothing is stored
// and the previous entry survives.
//
// An error's class does not survive the `use cache` boundary (it comes back as a plain Error, and in production
// the message is redacted), but `error.digest` does: Next keeps an existing digest when it serialises the error.
// The failure code is therefore encoded in the digest and decoded outside the cache into a real VamError.

export type Cacheable<T> = { ok: true; value: T } | { ok: false; code: 'not_found'; upstreamStatus?: number };

const DIGEST_PREFIX = 'vam:';
const CODES: readonly VamErrorCode[] = ['invalid_input', 'not_found', 'upstream', 'timeout', 'invalid_response'];

/** An Error whose digest carries the failure code and upstream status. The message is fixed text. */
export function encodeFailure(error: unknown): Error {
  const code: VamErrorCode = error instanceof VamError ? error.code : 'upstream';
  const status = error instanceof VamError ? error.upstreamStatus : undefined;
  const encoded = new Error(`V&A request failed: ${code}`);
  return Object.assign(encoded, { digest: `${DIGEST_PREFIX}${code}:${status === undefined ? '-' : String(status)}` });
}

/** Rebuilds a VamError from whatever came out of the cache boundary. Never throws; unknown shapes are `upstream`. */
export function decodeFailure(error: unknown): VamError {
  const digest = typeof error === 'object' && error !== null && 'digest' in error ? error.digest : undefined;
  const match = typeof digest === 'string' ? /^vam:([a-z_]+):(\d{3}|-)$/.exec(digest) : null;
  const code = CODES.find((c) => c === match?.[1]);
  if (!match || !code) return new VamError('upstream', 'V&A request failed: upstream');
  const status = match[2] === '-' ? undefined : Number(match[2]);
  return new VamError(code, `V&A request failed: ${code}`, status);
}

/** Resolves a value or a not-found answer (both safe to cache). Every other failure throws an encoded error. */
export async function cacheable<T>(work: () => Promise<T>): Promise<Cacheable<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (error instanceof VamError && error.code === 'not_found') {
      return {
        ok: false,
        code: 'not_found',
        ...(error.upstreamStatus === undefined ? {} : { upstreamStatus: error.upstreamStatus }),
      };
    }
    throw encodeFailure(error);
  }
}

/** The value, or a thrown not_found VamError. */
export function fromCacheable<T>(result: Cacheable<T>): T {
  if (result.ok) return result.value;
  throw new VamError('not_found', 'V&A request failed: not_found', result.upstreamStatus);
}
