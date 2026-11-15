import { describe, expect, it } from 'vitest';
import { VamError, type VamErrorCode } from './client';
import { cacheable, decodeFailure, encodeFailure, fromCacheable } from './outcome';

const ALL_CODES: VamErrorCode[] = ['invalid_input', 'not_found', 'upstream', 'timeout', 'invalid_response'];
const FAILURE_CODES = ALL_CODES.filter((c) => c !== 'not_found');

const digestOf = (error: unknown): unknown => (error as { digest?: unknown }).digest;

async function thrownBy(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }
  throw new Error('expected the work to throw');
}

/** Simulates the cache boundary: only `digest` survives; class and message are lost. */
function acrossBoundary(error: unknown): Error {
  const plain = new Error('generic');
  (plain as Error & { digest?: unknown }).digest = digestOf(error);
  return plain;
}

describe('cacheable', () => {
  it('wraps a resolved value', async () => {
    expect(await cacheable(() => Promise.resolve(7))).toEqual({ ok: true, value: 7 });
  });

  it('turns a not_found VamError into a not_found outcome with its upstream status', async () => {
    const outcome = await cacheable(() => Promise.reject(new VamError('not_found', 'x', 404)));
    expect(outcome).toEqual({ ok: false, code: 'not_found', upstreamStatus: 404 });
  });

  it('omits upstreamStatus on not_found when there is none', async () => {
    const outcome = await cacheable(() => Promise.reject(new VamError('not_found', 'no image')));
    expect(outcome).toEqual({ ok: false, code: 'not_found' });
    expect(outcome).not.toHaveProperty('upstreamStatus');
  });

  it.each(FAILURE_CODES)('throws for a transient %s failure instead of returning it', async (code) => {
    const error = await thrownBy(() => cacheable(() => Promise.reject(new VamError(code, 'detail', 500))));
    expect(error).toBeInstanceOf(Error);
    expect(digestOf(error)).toBe(`vam:${code}:500`);
  });

  it('throws for an unknown error, encoded as upstream', async () => {
    const error = await thrownBy(() => cacheable(() => Promise.reject(new Error('boom'))));
    expect(digestOf(error)).toBe('vam:upstream:-');
  });

  it('throws for a non-Error rejection too', async () => {
    const notAnError = 'just a string' as unknown as Error;
    const error = await thrownBy(() => cacheable(() => Promise.reject(notAnError)));
    expect(digestOf(error)).toBe('vam:upstream:-');
  });

  it('never leaks the original message in the thrown error', async () => {
    const error = (await thrownBy(() => cacheable(() => Promise.reject(new Error('sk-secret'))))) as Error;
    expect(error.message).not.toContain('sk-secret');
    expect(error.message.length).toBeGreaterThan(0);
    const vamError = (await thrownBy(() =>
      cacheable(() => Promise.reject(new VamError('upstream', 'sk-secret', 503))),
    )) as Error;
    expect(vamError.message).not.toContain('sk-secret');
  });

  it('uses the same message for the same failure code whatever the original message', async () => {
    const a = (await thrownBy(() => cacheable(() => Promise.reject(new VamError('timeout', 'one'))))) as Error;
    const b = (await thrownBy(() => cacheable(() => Promise.reject(new VamError('timeout', 'two'))))) as Error;
    expect(a.message).toBe(b.message);
  });

  it('only not_found is ever returned; every other code throws', async () => {
    for (const code of ALL_CODES) {
      const settled = await cacheable(() => Promise.reject(new VamError(code, 'x', 400))).then(
        (value) => ({ returned: true as const, value }),
        () => ({ returned: false as const }),
      );
      expect(settled.returned).toBe(code === 'not_found');
    }
  });

  it('produces outcomes that survive a JSON round trip', async () => {
    for (const outcome of [
      await cacheable(() => Promise.resolve({ a: [1, 2] })),
      await cacheable(() => Promise.reject(new VamError('not_found', 'x', 404))),
      await cacheable(() => Promise.reject(new VamError('not_found', 'x'))),
    ]) {
      expect(JSON.parse(JSON.stringify(outcome))).toEqual(outcome);
    }
  });
});

describe('encodeFailure', () => {
  it('encodes code and status in the digest', () => {
    expect(digestOf(encodeFailure(new VamError('upstream', 'x', 503)))).toBe('vam:upstream:503');
  });

  it('uses "-" when there is no status', () => {
    expect(digestOf(encodeFailure(new VamError('timeout', 'x')))).toBe('vam:timeout:-');
  });

  it('encodes an unknown error as upstream with no status', () => {
    expect(digestOf(encodeFailure(new Error('x')))).toBe('vam:upstream:-');
    expect(digestOf(encodeFailure(null))).toBe('vam:upstream:-');
    expect(digestOf(encodeFailure('str'))).toBe('vam:upstream:-');
  });

  it('returns an Error with fixed text that does not contain the original message', () => {
    const error = encodeFailure(new VamError('upstream', 'sk-secret', 500));
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain('sk-secret');
  });
});

describe('decodeFailure', () => {
  it('rebuilds a real VamError with the code and status', () => {
    const error = decodeFailure(Object.assign(new Error('x'), { digest: 'vam:upstream:503' }));
    expect(error).toBeInstanceOf(VamError);
    expect(error).toMatchObject({ code: 'upstream', upstreamStatus: 503 });
  });

  it('leaves upstreamStatus undefined for "-"', () => {
    const error = decodeFailure({ digest: 'vam:timeout:-' });
    expect(error).toMatchObject({ code: 'timeout' });
    expect(error.upstreamStatus).toBeUndefined();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'vam:timeout:-'],
    ['a number', 42],
    ['an empty object', {}],
    ['a plain Error without digest', new Error('x')],
    ['a non-string digest', { digest: 123 }],
    ['an empty digest', { digest: '' }],
    ['an unrelated digest', { digest: '1234567890' }],
    ['an unknown code', { digest: 'vam:exploded:500' }],
    ['a wrong prefix', { digest: 'foo:timeout:500' }],
    ['a missing status part', { digest: 'vam:timeout' }],
    ['a non-numeric status', { digest: 'vam:upstream:abc' }],
    ['extra parts', { digest: 'vam:upstream:503:extra' }],
  ])('falls back to upstream for %s without throwing', (_name, input) => {
    const error = decodeFailure(input);
    expect(error).toBeInstanceOf(VamError);
    expect(error.code).toBe('upstream');
  });

  it('does not carry a status when falling back', () => {
    expect(decodeFailure({ digest: 'vam:exploded:500' }).upstreamStatus).toBeUndefined();
  });
});

describe('encode/decode round trip', () => {
  it.each(ALL_CODES)('preserves code and status for %s', (code) => {
    const decoded = decodeFailure(encodeFailure(new VamError(code, 'x', 418)));
    expect(decoded).toMatchObject({ code, upstreamStatus: 418 });
  });

  it.each(ALL_CODES)('preserves code with no status for %s', (code) => {
    const decoded = decodeFailure(encodeFailure(new VamError(code, 'x')));
    expect(decoded.code).toBe(code);
    expect(decoded.upstreamStatus).toBeUndefined();
  });

  it('survives a boundary where only the digest is kept', async () => {
    for (const code of FAILURE_CODES) {
      const thrown = await thrownBy(() => cacheable(() => Promise.reject(new VamError(code, 'x', 502))));
      const crossed = acrossBoundary(thrown);
      expect(crossed).not.toBeInstanceOf(VamError);
      expect(crossed.message).toBe('generic');
      expect(decodeFailure(crossed)).toMatchObject({ code, upstreamStatus: 502 });
    }
  });
});

describe('fromCacheable', () => {
  it('returns the value of a successful outcome', () => {
    expect(fromCacheable({ ok: true, value: 'x' })).toBe('x');
  });

  it('throws a real VamError not_found with the status', () => {
    let caught: unknown;
    try {
      fromCacheable({ ok: false, code: 'not_found', upstreamStatus: 404 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(VamError);
    expect(caught).toMatchObject({ code: 'not_found', upstreamStatus: 404 });
  });

  it('throws not_found without a status when there was none', () => {
    expect(() => fromCacheable({ ok: false, code: 'not_found' })).toThrow(VamError);
  });
});
