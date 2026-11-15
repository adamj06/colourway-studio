import { describe, expect, it, vi } from 'vitest';
import { fetchWithRetry, UpstreamError } from './fetch-with-retry';

const asFetch = (fn: unknown) => fn as typeof fetch;
const ok = (status = 200) => new Response('x', { status });
const hangUntilAbort = (_url: string, init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => {
      reject(new DOMException('aborted', 'AbortError'));
    });
  });

describe('fetchWithRetry', () => {
  it('returns the first response without sleeping when it succeeds', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok());
    const sleep = vi.fn().mockResolvedValue(undefined);
    const res = await fetchWithRetry('https://api.vam.ac.uk/x', { fetch: asFetch(fetchFn), sleep });
    expect(res.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('passes the url, the headers and an abort signal to fetch', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok());
    await fetchWithRetry('https://api.vam.ac.uk/x', {
      fetch: asFetch(fetchFn),
      sleep: vi.fn(),
      headers: { 'User-Agent': 'colourway-studio/test' },
    });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.vam.ac.uk/x');
    expect(init.headers).toMatchObject({ 'User-Agent': 'colourway-studio/test' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('retries once after a network error and returns the second response', async () => {
    const fetchFn = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(ok(200));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const res = await fetchWithRetry('https://api.vam.ac.uk/x', { fetch: asFetch(fetchFn), sleep, backoffMs: 100 });
    expect(res.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    const waited = sleep.mock.calls[0]![0] as number;
    expect(waited).toBeGreaterThanOrEqual(100);
    expect(waited).toBeLessThanOrEqual(200);
  });

  it('retries once after a 5xx and returns the second response', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(ok(503)).mockResolvedValueOnce(ok(200));
    const res = await fetchWithRetry('https://api.vam.ac.uk/x', { fetch: asFetch(fetchFn), sleep: vi.fn() });
    expect(res.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it.each([400, 404, 422, 429])('never retries a %i and returns it', async (status) => {
    const fetchFn = vi.fn().mockResolvedValue(ok(status));
    const sleep = vi.fn();
    const res = await fetchWithRetry('https://api.vam.ac.uk/x', { fetch: asFetch(fetchFn), sleep });
    expect(res.status).toBe(status);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('throws UpstreamError kind http with the status after two 5xx responses', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(ok(500)).mockResolvedValueOnce(ok(502));
    const err = await fetchWithRetry('https://api.vam.ac.uk/x', { fetch: asFetch(fetchFn), sleep: vi.fn() }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err).toMatchObject({ kind: 'http', status: 502 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('throws UpstreamError kind network after two network failures and makes no third attempt', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const err = await fetchWithRetry('https://api.vam.ac.uk/x', { fetch: asFetch(fetchFn), sleep: vi.fn() }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).kind).toBe('network');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('aborts a hung request after timeoutMs and throws UpstreamError kind timeout', async () => {
    const fetchFn = vi.fn(hangUntilAbort);
    const err = await fetchWithRetry('https://api.vam.ac.uk/x', {
      fetch: asFetch(fetchFn),
      sleep: vi.fn().mockResolvedValue(undefined),
      timeoutMs: 20,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).kind).toBe('timeout');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('recovers when the first attempt times out and the second succeeds', async () => {
    // first call hangs (aborted by the timeout), second call resolves
    const fetchFn = vi
      .fn(hangUntilAbort)
      .mockImplementationOnce(hangUntilAbort)
      .mockImplementationOnce(() => Promise.resolve(ok(200)));
    const res = await fetchWithRetry('https://api.vam.ac.uk/x', {
      fetch: asFetch(fetchFn),
      sleep: vi.fn().mockResolvedValue(undefined),
      timeoutMs: 20,
    });
    expect(res.status).toBe(200);
  });

  it('uses a default timeout of 5000 ms on the abort signal', async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const fetchFn = vi.fn((_url: string, init: RequestInit) => {
        init.signal?.addEventListener('abort', () => {
          aborted = true;
        });
        return new Promise<Response>(() => undefined);
      });
      void fetchWithRetry('https://api.vam.ac.uk/x', { fetch: asFetch(fetchFn), sleep: vi.fn() }).catch(
        () => undefined,
      );
      await vi.advanceTimersByTimeAsync(4999);
      expect(aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('UpstreamError', () => {
  it('is an Error carrying kind and optional status', () => {
    const e = new UpstreamError('http', 503);
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe('http');
    expect(e.status).toBe(503);
    expect(new UpstreamError('timeout').status).toBeUndefined();
  });
});
