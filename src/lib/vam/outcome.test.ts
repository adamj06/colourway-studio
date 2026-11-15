import { describe, expect, it } from 'vitest';
import { VamError } from './client';
import { fromOutcome, isStable, toOutcome } from './outcome';

describe('toOutcome', () => {
  it('wraps a value', async () => {
    expect(await toOutcome(() => Promise.resolve(7))).toEqual({ ok: true, value: 7 });
  });

  it('keeps the code and upstream status of a VamError', async () => {
    const outcome = await toOutcome(() => Promise.reject(new VamError('upstream', 'secret detail', 503)));
    expect(outcome).toEqual({ ok: false, code: 'upstream', upstreamStatus: 503 });
  });

  it('omits upstreamStatus when there is none', async () => {
    const outcome = await toOutcome(() => Promise.reject(new VamError('timeout', 'slow')));
    expect(outcome).toEqual({ ok: false, code: 'timeout' });
    expect(outcome).not.toHaveProperty('upstreamStatus');
  });

  it('maps an unexpected error to upstream without carrying its message', async () => {
    const outcome = await toOutcome(() => Promise.reject(new Error('sk-secret')));
    expect(outcome).toEqual({ ok: false, code: 'upstream' });
  });

  it('survives a JSON round trip, which is what crossing the cache boundary does', async () => {
    const outcome = await toOutcome(() => Promise.reject(new VamError('not_found', 'x', 404)));
    expect(JSON.parse(JSON.stringify(outcome))).toEqual(outcome);
  });
});

describe('fromOutcome', () => {
  it('returns the value of a successful outcome', () => {
    expect(fromOutcome({ ok: true, value: 'x' })).toBe('x');
  });

  it('throws a real VamError with the code and status of a failed outcome', () => {
    let caught: unknown;
    try {
      fromOutcome({ ok: false, code: 'not_found', upstreamStatus: 404 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(VamError);
    expect(caught).toMatchObject({ code: 'not_found', upstreamStatus: 404 });
  });
});

describe('isStable', () => {
  it('is true for a value and for not_found, false for transient failures', () => {
    expect(isStable({ ok: true, value: 1 })).toBe(true);
    expect(isStable({ ok: false, code: 'not_found' })).toBe(true);
    for (const code of ['upstream', 'timeout', 'invalid_response', 'invalid_input'] as const) {
      expect(isStable({ ok: false, code })).toBe(false);
    }
  });
});
