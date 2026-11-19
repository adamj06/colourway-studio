import { beforeAll, describe, expect, it, vi } from 'vitest';

import { hexToRgb, labToRgb, rgbToLab } from './convert';
import { deltaE2000 } from './delta-e';
import { mulberry32 } from './prng';
import { applyLut, buildRecolourLut, recolour } from './recolour';
import type { Lab, Rgb } from './types';

// These tests build real lookup tables (65^3 nodes, a few hundred ms each). Under mutation testing the instrumented
// code is several times slower, so they need more than the default 5 s. The assertions are unchanged.
vi.setConfig({ testTimeout: 60_000 });

const labOf = (hex: string): Lab => rgbToLab(hexToRgb(hex));
const labsOf = (hexes: readonly string[]): Lab[] => hexes.map(labOf);

function rgba(pixels: readonly Rgb[], alpha: number | readonly number[] = 255): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b], i) => {
    out.set([r, g, b, typeof alpha === 'number' ? alpha : (alpha[i] ?? 255)], i * 4);
  });
  return out;
}

function pixelAt(data: Uint8ClampedArray, i: number): Rgb {
  return [data[i * 4] ?? -1, data[i * 4 + 1] ?? -1, data[i * 4 + 2] ?? -1];
}

const node = (i: number, size = 65): number => Math.round((i * 255) / (size - 1));

/**
 * Bound for the 65^3 table against the exact per-pixel recolour. Criterion 4 first said < 1. On a dense sweep a 33^3
 * table reaches about 3.9 (near-black, and next to a swatch colour where the 1/d^4 weights are steep), and a 65^3
 * table or softened weights did not get under 1 either. Adam relaxed the bound to 2.5 on 2026-11-18 (about the
 * smallest colour difference the eye can see) and chose the 65^3 table to meet it.
 */
const LUT_TOLERANCE = 2.5;

const FOUR_SOURCES = labsOf(['#C0392B', '#2E86C1', '#27AE60', '#F1C40F']);
const FOUR_TARGETS = labsOf(['#2ECC71', '#E67E22', '#8E44AD', '#1ABC9C']);
const EIGHT_SOURCES = labsOf(['#C0392B', '#2E86C1', '#27AE60', '#F1C40F', '#2C3E50', '#ECF0F1', '#7F8C8D', '#8E5A3C']);
const EIGHT_TARGETS = labsOf(['#1B4F72', '#CB4335', '#F4D03F', '#117A65', '#FDFEFE', '#17202A', '#D68910', '#5B2C6F']);
const ONE_CHANGED_TARGETS: Lab[] = [labOf('#00B050'), ...FOUR_SOURCES.slice(1)];

const CONFIGS: readonly (readonly [string, Lab[], Lab[]])[] = [
  ['one swatch changed a lot', FOUR_SOURCES, ONE_CHANGED_TARGETS],
  ['four swatches all changed', FOUR_SOURCES, FOUR_TARGETS],
  ['eight swatches all changed', EIGHT_SOURCES, EIGHT_TARGETS],
];

/** Deterministic sweep: coarse cube (mostly off grid nodes), greys, primaries, extremes, near-black/white, random. */
function sweep(): Rgb[] {
  const out: Rgb[] = [];
  const steps = [0, 19, 52, 87, 121, 158, 190, 233, 255];
  for (const r of steps) for (const g of steps) for (const b of steps) out.push([r, g, b]);
  for (let v = 0; v < 256; v += 3) out.push([v, v, v]);
  for (const c of [0, 255]) out.push([c, 0, 0], [0, c, 0], [0, 0, c], [c, c, 0], [c, 0, c], [0, c, c]);
  out.push([1, 1, 1], [2, 0, 1], [254, 254, 254], [253, 255, 254], [10, 10, 12], [245, 244, 246]);
  const rng = mulberry32(2024);
  for (let i = 0; i < 1500; i++) out.push([Math.floor(rng() * 256), Math.floor(rng() * 256), Math.floor(rng() * 256)]);
  return out;
}

/** The sRGB colour of a Lab value, via the library conversion. */
const rgbOf = (lab: Lab): Rgb => labToRgb(lab);

/** Colours at small offsets from a colour (what anti-aliased edges and shading around a swatch look like). */
function nearby(rgb: Rgb, seed: number): Rgb[] {
  const rng = mulberry32(seed);
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  const out: Rgb[] = [rgb];
  for (let i = 0; i < 40; i++) {
    const spread = i < 20 ? 2 : 8;
    out.push([
      clamp(rgb[0] + (rng() - 0.5) * 2 * spread),
      clamp(rgb[1] + (rng() - 0.5) * 2 * spread),
      clamp(rgb[2] + (rng() - 0.5) * 2 * spread),
    ]);
  }
  return out;
}

function expectWithin(actual: Uint8ClampedArray, expected: Uint8ClampedArray, tolerance: number, skipAlpha = false) {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) {
    if (skipAlpha && i % 4 === 3) continue;
    expect(Math.abs((actual[i] ?? 999) - (expected[i] ?? -999))).toBeLessThanOrEqual(tolerance);
  }
}

describe('buildRecolourLut', () => {
  it('returns size^3 * 3 values by default for a 65 grid', () => {
    const lut = buildRecolourLut(FOUR_SOURCES, FOUR_TARGETS);
    expect(lut).toBeInstanceOf(Float32Array);
    expect(lut).toHaveLength(65 ** 3 * 3);
  });

  it('honours a custom size', () => {
    expect(buildRecolourLut(FOUR_SOURCES, FOUR_TARGETS, 5)).toHaveLength(5 ** 3 * 3);
    expect(buildRecolourLut(FOUR_SOURCES, FOUR_TARGETS, 2)).toHaveLength(2 ** 3 * 3);
  });

  it('keeps every table value inside 0..255', () => {
    const lut = buildRecolourLut(EIGHT_SOURCES, EIGHT_TARGETS, 9);
    for (const v of lut) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });

  it('stores the direct recolour of each grid node in r-major order, within one level per channel', () => {
    const size = 5;
    const lut = buildRecolourLut(FOUR_SOURCES, FOUR_TARGETS, size);
    for (let n = 0; n < size ** 3; n++) {
      const r = Math.floor(n / (size * size));
      const g = Math.floor(n / size) % size;
      const b = n % size;
      const direct = recolour(rgba([[node(r, size), node(g, size), node(b, size)]]), FOUR_SOURCES, FOUR_TARGETS);
      for (let c = 0; c < 3; c++) {
        expect(Math.abs((lut[n * 3 + c] ?? 999) - (direct[c] ?? -999))).toBeLessThanOrEqual(1);
      }
    }
  });

  it('stays finite when a source lies a hair off a grid node colour (the weights would overflow in float32)', () => {
    const [l, a, b] = labOf('#808080');
    const sources: Lab[] = [[l + 1e-11, a, b], labOf('#C8281E')];
    const targets: Lab[] = [labOf('#2E86C1'), labOf('#F1C40F')];
    const lut = buildRecolourLut(sources, targets, 3);
    expect(lut.every((value) => Number.isFinite(value))).toBe(true);
    const input = rgba([
      [128, 128, 128],
      [120, 130, 125],
    ]);
    expectWithin(applyLut(input, lut, 3), recolour(input, sources, targets), 40);
    expect(applyLut(input, lut, 3).slice(0, 3)).not.toEqual(new Uint8ClampedArray([0, 0, 0]));
  });

  it('is deterministic', () => {
    const a = buildRecolourLut(FOUR_SOURCES, FOUR_TARGETS, 9);
    const b = buildRecolourLut(FOUR_SOURCES, FOUR_TARGETS, 9);
    expect([...a]).toEqual([...b]);
  });

  it('does not mutate its inputs', () => {
    const sources = FOUR_SOURCES.map((l) => [...l]);
    const targets = FOUR_TARGETS.map((l) => [...l]);
    buildRecolourLut(sources as unknown as Lab[], targets as unknown as Lab[], 5);
    expect(sources).toEqual(FOUR_SOURCES.map((l) => [...l]));
    expect(targets).toEqual(FOUR_TARGETS.map((l) => [...l]));
  });

  it('throws RangeError when there are no sources', () => {
    expect(() => buildRecolourLut([], [])).toThrow(RangeError);
  });

  it('throws RangeError when sources and targets differ in length', () => {
    expect(() => buildRecolourLut(FOUR_SOURCES, FOUR_TARGETS.slice(0, 3))).toThrow(RangeError);
    expect(() => buildRecolourLut(FOUR_SOURCES.slice(0, 3), FOUR_TARGETS)).toThrow(RangeError);
  });

  it.each([[1], [0], [-3], [2.5], [Number.NaN], [257]])('throws RangeError for size %s', (size) => {
    expect(() => buildRecolourLut(FOUR_SOURCES, FOUR_TARGETS, size)).toThrow(RangeError);
  });
});

describe('applyLut', () => {
  let lut: Float32Array = new Float32Array(0);
  beforeAll(() => {
    lut = buildRecolourLut(FOUR_SOURCES, FOUR_TARGETS);
  });

  it('returns a Uint8ClampedArray of the same length', () => {
    const out = applyLut(
      rgba([
        [10, 20, 30],
        [200, 100, 50],
      ]),
      lut,
    );
    expect(out).toBeInstanceOf(Uint8ClampedArray);
    expect(out).toHaveLength(8);
  });

  it('returns an empty array for an empty image', () => {
    expect(applyLut(new Uint8ClampedArray(0), lut)).toHaveLength(0);
  });

  it('leaves alpha unchanged for every pixel', () => {
    const alphas = [0, 1, 77, 128, 254, 255];
    const input = rgba(
      alphas.map((_, i): Rgb => [i * 40, 255 - i * 30, 17 * i]),
      alphas,
    );
    const out = applyLut(input, lut);
    alphas.forEach((a, i) => {
      expect(out[i * 4 + 3]).toBe(a);
    });
  });

  it('does not mutate its input or the table', () => {
    const input = rgba(sweep().slice(0, 200));
    const copy = Uint8ClampedArray.from(input);
    const lutCopy = Float32Array.from(lut);
    applyLut(input, lut);
    expect([...input]).toEqual([...copy]);
    expect([...lut]).toEqual([...lutCopy]);
  });

  it('is deterministic', () => {
    const input = rgba(sweep().slice(0, 500));
    expect([...applyLut(input, lut)]).toEqual([...applyLut(input, lut)]);
  });

  it('gives the same result for the same colour wherever it appears', () => {
    const out = applyLut(
      rgba([
        [100, 150, 200],
        [5, 5, 5],
        [100, 150, 200],
      ]),
      lut,
    );
    expect(pixelAt(out, 2)).toEqual(pixelAt(out, 0));
  });

  it('returns the table value at a node and the linear blend halfway between nodes', () => {
    // 2x2x2 table where node (r,g,b) holds 20 + 100 * index, so trilinear interpolation is predictable.
    const size = 2;
    const tiny = new Float32Array(size ** 3 * 3);
    for (let r = 0; r < 2; r++) {
      for (let g = 0; g < 2; g++) {
        for (let b = 0; b < 2; b++) tiny.set([20 + r * 100, 20 + g * 100, 20 + b * 100], ((r * 2 + g) * 2 + b) * 3);
      }
    }
    const out = applyLut(
      rgba([
        [0, 0, 0],
        [255, 255, 255],
        [0, 255, 0],
        [127.5, 0, 255],
      ]),
      tiny,
      size,
    );
    expect(pixelAt(out, 0)).toEqual([20, 20, 20]);
    expect(pixelAt(out, 1)).toEqual([120, 120, 120]);
    expect(pixelAt(out, 2)).toEqual([20, 120, 20]);
    // 127.5 is stored as 128 in a byte array (rounded), so r is 128/255 of the way: 20 + 50.2 -> 70
    expect(pixelAt(out, 3)).toEqual([70, 20, 120]);
  });

  it('rounds interpolated values to the nearest byte', () => {
    // Red channel is 10 at r=0 and 11 at r=1, for any g, b.
    const size = 2;
    const tiny = new Float32Array(size ** 3 * 3).fill(10);
    for (let g = 0; g < 2; g++) for (let b = 0; b < 2; b++) tiny[((2 + g) * 2 + b) * 3] = 11;
    const below = applyLut(rgba([[Math.floor(255 * 0.4), 0, 0]]), tiny, size);
    const above = applyLut(rgba([[Math.ceil(255 * 0.6), 0, 0]]), tiny, size);
    expect(below[0]).toBe(10);
    expect(above[0]).toBe(11);
  });

  it('accepts a custom size matching the table', () => {
    const small = buildRecolourLut(FOUR_SOURCES, FOUR_TARGETS, 17);
    expect(applyLut(rgba([[1, 2, 3]]), small, 17)).toHaveLength(4);
  });

  it('throws RangeError when the pixel data is not a multiple of 4', () => {
    expect(() => applyLut(new Uint8ClampedArray(7), lut)).toThrow(RangeError);
  });

  it('throws RangeError when the table length does not match the size', () => {
    expect(() => applyLut(rgba([[1, 2, 3]]), new Float32Array(10))).toThrow(RangeError);
    expect(() => applyLut(rgba([[1, 2, 3]]), lut, 17)).toThrow(RangeError);
  });
});

describe('LUT recolour against the direct recolour', () => {
  it('matches the direct recolour within 1 level per channel on exact grid nodes', () => {
    const nodes: Rgb[] = [
      [0, 0, 0],
      [255, 255, 255],
    ];
    const jk = [0, 8, 16, 32].flatMap((j) => [0, 16, 32].map((k): [number, number] => [j, k]));
    for (const i of [0, 1, 4, 8, 16, 24, 31, 32]) {
      for (const [j, k] of jk) nodes.push([node(i), node(j), node(k)]);
    }
    const input = rgba(nodes);
    for (const [, sources, targets] of CONFIGS) {
      expectWithin(applyLut(input, buildRecolourLut(sources, targets)), recolour(input, sources, targets), 1);
    }
  });

  it('is within 1 level per channel of the input when targets equal sources', () => {
    for (const sources of [FOUR_SOURCES, EIGHT_SOURCES]) {
      const input = rgba([...sweep(), ...sources.map(rgbOf)]);
      expectWithin(applyLut(input, buildRecolourLut(sources, sources)), input, 1, true);
    }
  });

  it.each(CONFIGS)(
    'stays within the LUT tolerance of the direct recolour over a dense sweep: %s',
    (_name, sources, targets) => {
      const pixels = [
        ...sweep(),
        ...[...sources, ...targets].map(rgbOf),
        ...sources.flatMap((s, i) => nearby(rgbOf(s), 100 + i)),
        ...targets.flatMap((t, i) => nearby(rgbOf(t), 200 + i)),
      ];
      const input = rgba(pixels);
      const viaLut = applyLut(input, buildRecolourLut(sources, targets));
      const direct = recolour(input, sources, targets);
      const bad: string[] = [];
      for (let p = 0; p < pixels.length; p++) {
        const d = deltaE2000(rgbToLab(pixelAt(viaLut, p)), rgbToLab(pixelAt(direct, p)));
        if (!(d <= LUT_TOLERANCE)) bad.push(`${String(pixels[p])} dE ${d.toFixed(2)}`);
      }
      expect(bad.slice(0, 5)).toEqual([]);
    },
  );

  it('stays within the LUT tolerance right on and next to each source colour, where the weights are singular', () => {
    for (const [, sources, targets] of CONFIGS) {
      const pixels = sources.flatMap((s, i) => nearby(rgbOf(s), 300 + i));
      const input = rgba(pixels);
      const viaLut = applyLut(input, buildRecolourLut(sources, targets));
      const direct = recolour(input, sources, targets);
      for (let p = 0; p < pixels.length; p++) {
        expect(deltaE2000(rgbToLab(pixelAt(viaLut, p)), rgbToLab(pixelAt(direct, p)))).toBeLessThanOrEqual(
          LUT_TOLERANCE,
        );
      }
    }
  });
});
