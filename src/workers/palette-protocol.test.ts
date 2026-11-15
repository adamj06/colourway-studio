import { describe, expect, it } from 'vitest';

import { requestSchema, responseSchema } from './palette-protocol';

function image(width: number, height: number, length = width * height * 4) {
  return { width, height, data: new Uint8ClampedArray(length) };
}

/** Length that matches width*height*4 whenever that is a valid array length, so only the size limits are under test. */
function matchingLength(width: number, height: number): number {
  const n = width * height * 4;
  return Number.isInteger(n) && n >= 0 ? n : 4;
}

function analyse(overrides: Record<string, unknown> = {}): unknown {
  return { type: 'analyse', id: 1, k: 6, image: image(2, 2), ...overrides };
}

function ok(value: unknown): boolean {
  return requestSchema.safeParse(value).success;
}

function okResponse(value: unknown): boolean {
  return responseSchema.safeParse(value).success;
}

const swatch = { hex: '#C0392B', lab: [40, 50, 30], share: 0.5 };

describe('requestSchema: analyse', () => {
  it('accepts a valid analyse request', () => {
    expect(ok(analyse())).toBe(true);
  });

  it('keeps the parsed pixel data as a Uint8ClampedArray', () => {
    const parsed = requestSchema.safeParse(analyse());
    expect(parsed.success).toBe(true);
    const data = parsed.success && parsed.data.type === 'analyse' ? parsed.data.image.data : undefined;
    expect(data).toBeInstanceOf(Uint8ClampedArray);
    expect(data).toHaveLength(16);
  });

  it.each([
    [0, true],
    [1, true],
    [123_456, true],
    [-1, false],
    [1.5, false],
    [Number.NaN, false],
    ['1', false],
  ])('treats id %s as valid=%s', (id, valid) => {
    expect(ok(analyse({ id }))).toBe(valid);
  });

  it.each([
    [3, false],
    [4, true],
    [5, true],
    [8, true],
    [9, false],
    [4.5, false],
    [0, false],
    ['6', false],
  ])('treats k %s as valid=%s', (k, valid) => {
    expect(ok(analyse({ k }))).toBe(valid);
  });

  it('rejects a missing k', () => {
    expect(ok({ type: 'analyse', id: 1, image: image(2, 2) })).toBe(false);
  });

  it.each([
    [0, 1, false],
    [1, 1, true],
    [1024, 1, true],
    [1025, 1, false],
    [1.5, 1, false],
    [-1, 1, false],
  ])('treats width %s (height %s) as valid=%s', (width, height, valid) => {
    expect(ok(analyse({ image: image(width, height, matchingLength(width, height)) }))).toBe(valid);
  });

  it.each([
    [1, 0, false],
    [1, 1, true],
    [1, 1024, true],
    [1, 1025, false],
    [1, 1.5, false],
  ])('treats height for width %s: %s as valid=%s', (width, height, valid) => {
    expect(ok(analyse({ image: image(width, height, matchingLength(width, height)) }))).toBe(valid);
  });

  it('accepts the largest allowed image, 1024 x 1024', () => {
    expect(ok(analyse({ image: image(1024, 1024) }))).toBe(true);
  });

  it('rejects an image over the width limit even when the data length matches', () => {
    expect(ok(analyse({ image: image(1025, 1) }))).toBe(false);
  });

  it('rejects an image over the height limit even when the data length matches', () => {
    expect(ok(analyse({ image: image(1, 1025) }))).toBe(false);
  });

  it('rejects data one byte too short', () => {
    expect(ok(analyse({ image: image(2, 2, 15) }))).toBe(false);
  });

  it('rejects data one byte too long', () => {
    expect(ok(analyse({ image: image(2, 2, 17) }))).toBe(false);
  });

  it('rejects empty data for a non-empty image', () => {
    expect(ok(analyse({ image: image(2, 2, 0) }))).toBe(false);
  });

  it('rejects pixel data that is a plain array rather than a Uint8ClampedArray', () => {
    expect(ok(analyse({ image: { width: 1, height: 1, data: [0, 0, 0, 0] } }))).toBe(false);
  });

  it('rejects pixel data that is a different typed array', () => {
    expect(ok(analyse({ image: { width: 1, height: 1, data: new Uint8Array(4) } }))).toBe(false);
  });

  it('rejects a missing image', () => {
    expect(ok({ type: 'analyse', id: 1, k: 6 })).toBe(false);
  });
});

describe('requestSchema: set-k', () => {
  it('accepts a valid set-k request', () => {
    expect(ok({ type: 'set-k', id: 2, k: 5 })).toBe(true);
  });

  it.each([
    [3, false],
    [4, true],
    [8, true],
    [9, false],
    [5.5, false],
  ])('treats k %s as valid=%s', (k, valid) => {
    expect(ok({ type: 'set-k', id: 2, k })).toBe(valid);
  });

  it.each([
    [0, true],
    [-1, false],
    [2.5, false],
  ])('treats id %s as valid=%s', (id, valid) => {
    expect(ok({ type: 'set-k', id, k: 5 })).toBe(valid);
  });

  it('rejects set-k without an id', () => {
    expect(ok({ type: 'set-k', k: 5 })).toBe(false);
  });
});

describe('requestSchema: shape', () => {
  it.each([
    ['unknown type', { type: 'nope', id: 1, k: 5 }],
    ['missing type', { id: 1, k: 5 }],
    ['null', null],
    ['a string', 'analyse'],
    ['a number', 42],
    ['an array', []],
    ['undefined', undefined],
  ])('rejects %s', (_name, value) => {
    expect(ok(value)).toBe(false);
  });
});

describe('responseSchema', () => {
  it('accepts a palette response', () => {
    expect(okResponse({ type: 'palette', id: 3, k: 6, swatches: [swatch] })).toBe(true);
  });

  it('accepts a palette response with no swatches', () => {
    expect(okResponse({ type: 'palette', id: 3, k: 6, swatches: [] })).toBe(true);
  });

  it.each([
    ['lowercase hex', { ...swatch, hex: '#c0392b' }],
    ['three-digit hex', { ...swatch, hex: '#C39' }],
    ['hex without hash', { ...swatch, hex: 'C0392B' }],
    ['hex with extra char', { ...swatch, hex: '#C0392B0' }],
    ['non-hex letter', { ...swatch, hex: '#G0392B' }],
    ['two-element lab', { ...swatch, lab: [40, 50] }],
    ['four-element lab', { ...swatch, lab: [40, 50, 30, 1] }],
    ['string lab component', { ...swatch, lab: [40, '50', 30] }],
    ['negative share', { ...swatch, share: -0.1 }],
    ['share above 1', { ...swatch, share: 1.1 }],
    ['missing share', { hex: swatch.hex, lab: swatch.lab }],
  ])('rejects a palette response whose swatch has %s', (_name, bad) => {
    expect(okResponse({ type: 'palette', id: 3, k: 6, swatches: [bad] })).toBe(false);
  });

  it.each([0, 1, 0.5])('accepts share %s', (share) => {
    expect(okResponse({ type: 'palette', id: 3, k: 6, swatches: [{ ...swatch, share }] })).toBe(true);
  });

  it('rejects a palette response without swatches', () => {
    expect(okResponse({ type: 'palette', id: 3, k: 6 })).toBe(false);
  });

  it('accepts an error response with a numeric id', () => {
    expect(okResponse({ type: 'error', id: 4, message: 'boom' })).toBe(true);
  });

  it('accepts an error response with a null id', () => {
    expect(okResponse({ type: 'error', id: null, message: 'boom' })).toBe(true);
  });

  it('rejects an error response with a negative id', () => {
    expect(okResponse({ type: 'error', id: -1, message: 'boom' })).toBe(false);
  });

  it('rejects an error response without a message', () => {
    expect(okResponse({ type: 'error', id: 1 })).toBe(false);
  });

  it('rejects an error response with a non-string message', () => {
    expect(okResponse({ type: 'error', id: 1, message: 5 })).toBe(false);
  });

  it('rejects an unknown response type', () => {
    expect(okResponse({ type: 'other', id: 1 })).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(okResponse(null)).toBe(false);
    expect(okResponse('palette')).toBe(false);
  });
});

describe('responseSchema: swatch cap', () => {
  const swatch = { hex: '#AABBCC', lab: [1, 2, 3], share: 0.1 };
  const response = (count: number) => ({
    type: 'palette',
    id: 0,
    k: 8,
    swatches: Array.from({ length: count }, () => swatch),
  });

  it('accepts as many swatches as the largest k', () => {
    expect(responseSchema.safeParse(response(8)).success).toBe(true);
  });

  it('rejects more swatches than the largest k', () => {
    expect(responseSchema.safeParse(response(9)).success).toBe(false);
  });
});
