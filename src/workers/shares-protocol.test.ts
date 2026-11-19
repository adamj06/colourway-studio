// Feature 005: the 'shares' message pair. Request: { type: 'shares', id, labs: [L,a,b][] (1..MAX_K), image }.
// Response: { type: 'shares', id, shares: number[] (each 0..1, at most MAX_K) }.
import { describe, expect, it } from 'vitest';

import { MAX_K, requestSchema, responseSchema } from './palette-protocol';

function image(width: number, height: number, length = width * height * 4) {
  return { width, height, data: new Uint8ClampedArray(length) };
}

const lab = (n: number) => [50 + n, n, -n];
const labs = (count: number) => Array.from({ length: count }, (_, i) => lab(i));

function shares(overrides: Record<string, unknown> = {}): unknown {
  return { type: 'shares', id: 1, labs: labs(3), image: image(2, 2), ...overrides };
}

const ok = (value: unknown) => requestSchema.safeParse(value).success;
const okResponse = (value: unknown) => responseSchema.safeParse(value).success;

describe('requestSchema: shares', () => {
  it('accepts a valid shares request', () => {
    expect(ok(shares())).toBe(true);
  });

  it('keeps the parsed labs and pixel data', () => {
    const parsed = requestSchema.safeParse(shares());
    expect(parsed.success).toBe(true);
    if (!parsed.success || parsed.data.type !== ('shares' as string)) throw new Error('expected shares');
    const data = parsed.data as unknown as { labs: number[][]; image: { data: Uint8ClampedArray } };
    expect(data.labs).toEqual(labs(3));
    expect(data.image.data).toBeInstanceOf(Uint8ClampedArray);
  });

  it.each([
    [0, false],
    [1, true],
    [MAX_K, true],
    [MAX_K + 1, false],
    [9, false],
  ])('treats %i labs as valid=%s (1 to MAX_K)', (count, valid) => {
    expect(ok(shares({ labs: labs(count) }))).toBe(valid);
  });

  it.each([
    [0, true],
    [7, true],
    [-1, false],
    [1.5, false],
    [Number.NaN, false],
    ['1', false],
  ])('treats id %s as valid=%s', (id, valid) => {
    expect(ok(shares({ id }))).toBe(valid);
  });

  it('rejects a missing id', () => {
    expect(ok({ type: 'shares', labs: labs(3), image: image(2, 2) })).toBe(false);
  });

  it('rejects a missing labs field', () => {
    expect(ok({ type: 'shares', id: 1, image: image(2, 2) })).toBe(false);
  });

  it('rejects a missing image', () => {
    expect(ok({ type: 'shares', id: 1, labs: labs(3) })).toBe(false);
  });

  it('does not require a k', () => {
    expect(ok(shares())).toBe(true);
  });

  it.each([
    ['NaN', [Number.NaN, 0, 0]],
    ['Infinity', [0, Number.POSITIVE_INFINITY, 0]],
    ['-Infinity', [0, 0, Number.NEGATIVE_INFINITY]],
    ['a string', [50, '3', 0]],
    ['null', [50, null, 0]],
    ['too short', [50, 0]],
    ['too long', [50, 0, 0, 0]],
    ['empty', []],
  ])('rejects a lab that is %s', (_name, bad) => {
    expect(ok(shares({ labs: [lab(0), bad] }))).toBe(false);
  });

  it('accepts negative and fractional lab components', () => {
    expect(ok(shares({ labs: [[12.5, -80.25, 99.9]] }))).toBe(true);
  });

  it('rejects labs that are not an array', () => {
    expect(ok(shares({ labs: 'nope' }))).toBe(false);
    expect(ok(shares({ labs: null }))).toBe(false);
  });

  it.each([
    ['zero width', image(0, 4, 0)],
    ['width above the limit', image(1025, 1)],
    ['height above the limit', image(1, 1025)],
    ['wrong data length', image(3, 3, 10)],
    ['plain-array pixel data', { width: 1, height: 1, data: [0, 0, 0, 255] }],
  ])('rejects a bad image: %s', (_name, bad) => {
    expect(ok(shares({ image: bad }))).toBe(false);
  });

  it('accepts an image at the 1024 side limit', () => {
    expect(ok(shares({ image: { width: 1024, height: 1, data: new Uint8ClampedArray(1024 * 4) } }))).toBe(true);
  });

  it('still accepts analyse and set-k requests', () => {
    expect(ok({ type: 'analyse', id: 1, k: 6, image: image(2, 2) })).toBe(true);
    expect(ok({ type: 'set-k', id: 1, k: 6 })).toBe(true);
  });
});

describe('responseSchema: shares', () => {
  it('accepts a valid shares response', () => {
    expect(okResponse({ type: 'shares', id: 3, shares: [0.5, 0.25, 0.25] })).toBe(true);
  });

  it('accepts the boundary values 0 and 1', () => {
    expect(okResponse({ type: 'shares', id: 3, shares: [0, 1] })).toBe(true);
  });

  it('accepts an empty shares array', () => {
    expect(okResponse({ type: 'shares', id: 3, shares: [] })).toBe(true);
  });

  it('accepts exactly MAX_K shares and rejects one more', () => {
    expect(okResponse({ type: 'shares', id: 3, shares: Array<number>(MAX_K).fill(0.1) })).toBe(true);
    expect(okResponse({ type: 'shares', id: 3, shares: Array<number>(MAX_K + 1).fill(0.1) })).toBe(false);
  });

  it.each([[-0.01], [1.01], [Number.NaN], [Number.POSITIVE_INFINITY]])('rejects a share of %s', (bad) => {
    expect(okResponse({ type: 'shares', id: 3, shares: [0.5, bad] })).toBe(false);
  });

  it('rejects a null id (only errors may have one)', () => {
    expect(okResponse({ type: 'shares', id: null, shares: [1] })).toBe(false);
  });

  it('rejects a missing shares field', () => {
    expect(okResponse({ type: 'shares', id: 3 })).toBe(false);
  });

  it('rejects non-number shares', () => {
    expect(okResponse({ type: 'shares', id: 3, shares: ['0.5'] })).toBe(false);
  });
});
