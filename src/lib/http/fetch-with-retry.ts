export type UpstreamErrorKind = 'timeout' | 'network' | 'http' | 'invalid';

/**
 * An upstream call failed after its retry. `status` is set only for kind 'http'. Kind 'invalid' means the
 * response arrived but was not acceptable JSON (wrong content-type, too large, unparseable): it is never retried.
 */
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
  /** Per-attempt timeout, covering the response body too for fetchJsonWithRetry. Default 5000. */
  timeoutMs?: number;
  /** Base delay before the single retry. Default 300. Jitter adds up to the same again. */
  backoffMs?: number;
  headers?: Record<string, string>;
  /** Largest JSON body accepted by fetchJsonWithRetry, in bytes. Default 2 MB. */
  maxBytes?: number;
};

export type JsonResult = { status: number; ok: boolean; body: unknown };

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_BACKOFF_MS = 300;
const DEFAULT_MAX_BYTES = 2_000_000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

type Attempt<T> = { value: T } | { error: UpstreamError };

function classify(error: unknown, signal: AbortSignal): UpstreamError {
  if (error instanceof UpstreamError) return error;
  const aborted = signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
  return new UpstreamError(aborted ? 'timeout' : 'network');
}

async function attempt<T>(
  url: string,
  init: FetchWithRetryInit,
  consume: (response: Response) => Promise<T>,
): Promise<Attempt<T>> {
  const doFetch = init.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    // redirect: 'manual' so a redirect can never take us to a host that isn't the one we asked for.
    const response = await doFetch(url, {
      headers: init.headers ?? {},
      signal: controller.signal,
      redirect: 'manual',
    });
    if (response.status >= 500) {
      await response.body?.cancel().catch(() => undefined);
      return { error: new UpstreamError('http', response.status) };
    }
    // The timer stays armed while the body is consumed, so a stalled body times out too.
    return { value: await consume(response) };
  } catch (error) {
    return { error: classify(error, controller.signal) };
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry<T>(
  url: string,
  init: FetchWithRetryInit,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  const first = await attempt(url, init, consume);
  if ('value' in first) return first.value;
  if (first.error.kind === 'invalid') throw first.error;

  const backoff = init.backoffMs ?? DEFAULT_BACKOFF_MS;
  await (init.sleep ?? defaultSleep)(backoff + Math.random() * backoff);

  const second = await attempt(url, init, consume);
  if ('value' in second) return second.value;
  throw second.error;
}

/**
 * GET with a per-attempt timeout and exactly one retry (after a short backoff) on a network error, a timeout or a
 * 5xx. 4xx responses are returned untouched and never retried. Redirects are not followed (a 3xx is returned as is).
 * Throws UpstreamError when both attempts fail. The body is NOT covered by the timeout: use fetchJsonWithRetry for that.
 */
export function fetchWithRetry(url: string, init: FetchWithRetryInit = {}): Promise<Response> {
  return withRetry(url, init, (response) => Promise.resolve(response));
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new UpstreamError('invalid');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new UpstreamError('invalid');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function readJson(response: Response, maxBytes: number): Promise<JsonResult> {
  const { status, ok } = response;
  if (!ok) {
    await response.body?.cancel().catch(() => undefined);
    return { status, ok, body: undefined };
  }
  if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('json')) {
    await response.body?.cancel().catch(() => undefined);
    throw new UpstreamError('invalid');
  }
  const text = await readCapped(response, maxBytes);
  try {
    return { status, ok, body: JSON.parse(text) as unknown };
  } catch {
    throw new UpstreamError('invalid');
  }
}

/**
 * Like fetchWithRetry, but also reads the JSON body inside the timeout. Only a 2xx body is read: it must declare a
 * JSON content-type, stay under maxBytes and parse, otherwise UpstreamError kind 'invalid' (not retried).
 */
export function fetchJsonWithRetry(url: string, init: FetchWithRetryInit = {}): Promise<JsonResult> {
  return withRetry(url, init, (response) => readJson(response, init.maxBytes ?? DEFAULT_MAX_BYTES));
}
