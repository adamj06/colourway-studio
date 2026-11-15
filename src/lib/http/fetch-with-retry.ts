export type UpstreamErrorKind = 'timeout' | 'network' | 'http';

/** An upstream call failed after its retry. `status` is set only for kind 'http'. */
export class UpstreamError extends Error {
  readonly kind: UpstreamErrorKind;
  readonly status: number | undefined;

  constructor(kind: UpstreamErrorKind, status?: number) {
    super(status === undefined ? `Upstream ${kind} error` : `Upstream ${kind} error (${String(status)})`);
    this.name = 'UpstreamError';
    this.kind = kind;
    this.status = status;
  }
}

export type FetchWithRetryInit = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Per-attempt timeout. Default 5000. */
  timeoutMs?: number;
  /** Base delay before the single retry. Default 300. Jitter adds up to the same again. */
  backoffMs?: number;
  headers?: Record<string, string>;
};

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_BACKOFF_MS = 300;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

type Attempt = { response: Response } | { error: UpstreamError };

async function attempt(url: string, init: FetchWithRetryInit): Promise<Attempt> {
  const doFetch = init.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await doFetch(url, { headers: init.headers ?? {}, signal: controller.signal });
    if (response.status >= 500) {
      await response.body?.cancel().catch(() => undefined);
      return { error: new UpstreamError('http', response.status) };
    }
    return { response };
  } catch (error) {
    const aborted = controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
    return { error: new UpstreamError(aborted ? 'timeout' : 'network') };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET with a per-attempt timeout and exactly one retry (after a short backoff) on a network error, a timeout or a
 * 5xx. 4xx responses are returned untouched and never retried. Throws UpstreamError when both attempts fail.
 */
export async function fetchWithRetry(url: string, init: FetchWithRetryInit = {}): Promise<Response> {
  const first = await attempt(url, init);
  if ('response' in first) return first.response;

  const backoff = init.backoffMs ?? DEFAULT_BACKOFF_MS;
  await (init.sleep ?? defaultSleep)(backoff + Math.random() * backoff);

  const second = await attempt(url, init);
  if ('response' in second) return second.response;
  throw second.error;
}
