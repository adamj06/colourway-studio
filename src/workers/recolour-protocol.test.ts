import { describe, expect, it } from 'vitest';

import { MAX_K } from './palette-protocol';
import { MAX_RECOLOUR_SIDE, MIN_SWATCHES, requestSchema, responseSchema } from './recolour-protocol';

const lab = (i: number): [number, number, number] => [50 + i, i, -i];
const labs = (n: number) => Array.from({ length: n }, (_, i) => lab(i));
const image = (width = 2, height = 2) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });
const prepare = (overrides: Record<string, unknown> = {}) => ({
  type: 'prepare',
  id: 1,
  image: image(),
  sources: labs(5),
  ...overrides,
});
const recolourReq = (overrides: Record<string, unknown> = {}) => ({
  type: 'recolour',
  id: 2,
  targets: labs(5),
  ...overrides,
});

describe('recolour request schema: prepare', () => {
  it('accepts a valid prepare request', () => {
    expect(requestSchema.safeParse(prepare()).success).toBe(true);
  });

  it('exposes a 2048 pixel side cap', () => {
    expect(MAX_RECOLOUR_SIDE).toBe(2048);
  });

  it('accepts an image exactly at the side cap in each direction', () => {
    expect(requestSchema.safeParse(prepare({ image: image(MAX_RECOLOUR_SIDE, 1) })).success).toBe(true);
    expect(requestSchema.safeParse(prepare({ image: image(1, MAX_RECOLOUR_SIDE) })).success).toBe(true);
  });

  it('accepts one swatch (a palette can merge down to one colour) up to the maximum', () => {
    expect(requestSchema.safeParse(prepare({ sources: labs(MIN_SWATCHES) })).success).toBe(true);
    expect(requestSchema.safeParse(prepare({ sources: labs(MAX_K) })).success).toBe(true);
  });

  it.each([
    ['width above the cap', { image: image(MAX_RECOLOUR_SIDE + 1, 1) }],
    ['height above the cap', { image: image(1, MAX_RECOLOUR_SIDE + 1) }],
    ['zero width', { image: { width: 0, height: 1, data: new Uint8ClampedArray(0) } }],
    ['zero height', { image: { width: 1, height: 0, data: new Uint8ClampedArray(0) } }],
    ['fractional width', { image: { width: 1.5, height: 1, data: new Uint8ClampedArray(6) } }],
    ['negative width', { image: { width: -1, height: 1, data: new Uint8ClampedArray(4) } }],
    ['NaN width', { image: { width: Number.NaN, height: 1, data: new Uint8ClampedArray(4) } }],
    ['data too short', { image: { width: 2, height: 2, data: new Uint8ClampedArray(15) } }],
    ['data too long', { image: { width: 2, height: 2, data: new Uint8ClampedArray(17) } }],
    ['plain array data', { image: { width: 1, height: 1, data: [0, 0, 0, 255] } }],
    ['Uint8Array rather than clamped data', { image: { width: 1, height: 1, data: new Uint8Array(4) } }],
    ['missing image', { image: undefined }],
    ['too few sources', { sources: labs(MIN_SWATCHES - 1) }],
    ['too many sources', { sources: labs(MAX_K + 1) }],
    ['a source with two components', { sources: [...labs(4), [1, 2]] }],
    ['a source with four components', { sources: [...labs(4), [1, 2, 3, 4]] }],
    ['a NaN source component', { sources: [...labs(4), [Number.NaN, 0, 0]] }],
    ['a string source component', { sources: [...labs(4), ['50', 0, 0]] }],
    ['missing sources', { sources: undefined }],
    ['negative id', { id: -1 }],
    ['fractional id', { id: 1.5 }],
    ['string id', { id: '1' }],
    ['missing id', { id: undefined }],
  ])('rejects a prepare request with %s', (_name, overrides) => {
    expect(requestSchema.safeParse(prepare(overrides)).success).toBe(false);
  });
});

describe('recolour request schema: recolour', () => {
  it('accepts a valid recolour request', () => {
    expect(requestSchema.safeParse(recolourReq()).success).toBe(true);
  });

  it('accepts the minimum and maximum number of targets', () => {
    expect(requestSchema.safeParse(recolourReq({ targets: labs(MIN_SWATCHES) })).success).toBe(true);
    expect(requestSchema.safeParse(recolourReq({ targets: labs(MAX_K) })).success).toBe(true);
  });

  it('accepts the preview and final qualities, and no quality at all', () => {
    expect(requestSchema.safeParse(recolourReq({ quality: 'preview' })).success).toBe(true);
    expect(requestSchema.safeParse(recolourReq({ quality: 'final' })).success).toBe(true);
    expect(requestSchema.safeParse(recolourReq()).success).toBe(true);
  });

  it.each([
    ['an unknown quality', { quality: 'draft' }],
    ['a numeric quality', { quality: 1 }],
    ['too few targets', { targets: labs(MIN_SWATCHES - 1) }],
    ['too many targets', { targets: labs(MAX_K + 1) }],
    ['a NaN target component', { targets: [...labs(4), [0, Number.NaN, 0]] }],
    ['a target with two components', { targets: [...labs(4), [1, 2]] }],
    ['hex strings instead of Lab', { targets: ['#112233', '#223344', '#334455', '#445566'] }],
    ['missing targets', { targets: undefined }],
    ['negative id', { id: -3 }],
    ['fractional id', { id: 0.5 }],
  ])('rejects a recolour request with %s', (_name, overrides) => {
    expect(requestSchema.safeParse(recolourReq(overrides)).success).toBe(false);
  });
});

describe('recolour request schema: shape', () => {
  it.each([
    ['an unknown type', { type: 'explode', id: 1 }],
    ['no type', { id: 1 }],
    ['the palette worker type', { type: 'analyse', id: 1, k: 5, image: image() }],
    ['null', null],
    ['a string', 'prepare'],
    ['an array', []],
    ['undefined', undefined],
  ])('rejects %s', (_name, value) => {
    expect(requestSchema.safeParse(value).success).toBe(false);
  });
});

describe('recolour response schema', () => {
  it('accepts an image response', () => {
    const data = new Uint8ClampedArray(2 * 3 * 4);
    expect(responseSchema.safeParse({ type: 'image', id: 4, width: 2, height: 3, data }).success).toBe(true);
  });

  it('accepts an error with an id and an error with a null id', () => {
    expect(responseSchema.safeParse({ type: 'error', id: 4, message: 'nope' }).success).toBe(true);
    expect(responseSchema.safeParse({ type: 'error', id: null, message: 'nope' }).success).toBe(true);
  });

  it.each([
    ['an image without data', { type: 'image', id: 1, width: 1, height: 1 }],
    ['an image with plain array data', { type: 'image', id: 1, width: 1, height: 1, data: [0, 0, 0, 0] }],
    ['an image with a missing id', { type: 'image', width: 1, height: 1, data: new Uint8ClampedArray(4) }],
    ['an image with a negative id', { type: 'image', id: -1, width: 1, height: 1, data: new Uint8ClampedArray(4) }],
    ['an image with a zero width', { type: 'image', id: 1, width: 0, height: 1, data: new Uint8ClampedArray(0) }],
    ['an error without a message', { type: 'error', id: 1 }],
    ['an error with a numeric message', { type: 'error', id: 1, message: 5 }],
    ['an error with undefined id', { type: 'error', message: 'x' }],
    ['an unknown type', { type: 'palette', id: 1 }],
    ['null', null],
  ])('rejects %s', (_name, value) => {
    expect(responseSchema.safeParse(value).success).toBe(false);
  });
});
