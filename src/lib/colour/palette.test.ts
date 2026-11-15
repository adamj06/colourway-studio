import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { bands, buildImage, checkerboard, solidImage } from '../../../tests/helpers/colour';
import { hexToRgb, labToRgb, rgbToHex, rgbToLab } from './convert';
import { deltaE2000 } from './delta-e';
import { DEFAULT_SEED, extractPalette, extractPaletteFromSamples, MERGE_DELTA_E } from './palette';
import { sampleLabPixels } from './sample';
import type { Lab, PixelBuffer, Rgb, Swatch } from './types';

const RED = '#C0392B';
const BLUE = '#2E86C1';
const GREEN = '#27AE60';

function hexes(swatches: readonly Swatch[]): string[] {
  return swatches.map((s) => s.hex);
}

/**
 * Finds a colour whose deltaE2000 from `base` is the first value >= `target`, by nudging L of the base
 * and re-quantising to 8-bit. The caller asserts the achieved distance, so no reference numbers are assumed.
 */
function partnerAtLeast(base: Rgb, target: number): Rgb {
  const [l, a, b] = rgbToLab(base);
  const baseLab = rgbToLab(base);
  for (let step = 1; step < 2000; step++) {
    const candidate = labToRgb([l + step * 0.05, a, b]);
    if (deltaE2000(baseLab, rgbToLab(candidate)) >= target) return candidate;
  }
  throw new Error('no partner found');
}

function mixImage(top: Rgb, topPixels: number, bottom: Rgb, bottomPixels: number): PixelBuffer {
  const total = topPixels + bottomPixels;
  return buildImage(total, 1, (x) => ({ rgb: x < topPixels ? top : bottom }));
}

describe('constants', () => {
  it('merges swatches closer than deltaE 5 and seeds with 1 by default', () => {
    expect(MERGE_DELTA_E).toBe(5);
    expect(DEFAULT_SEED).toBe(1);
  });
});

describe('extractPalette: known images', () => {
  it('finds exactly the two colours of a checkerboard with k=6, each at share 0.5', () => {
    const swatches = extractPalette(checkerboard(RED, BLUE, 16), { k: 6 });
    expect(swatches).toHaveLength(2);
    // ties on share sort by hex ascending
    expect(hexes(swatches)).toEqual([BLUE, RED]);
    for (const s of swatches) {
      expect(s.share).toBeCloseTo(0.5, 9);
    }
  });

  it('reports each swatch Lab as the Lab of its colour', () => {
    const swatches = extractPalette(checkerboard(RED, BLUE, 16), { k: 6 });
    const byHex = new Map(swatches.map((s) => [s.hex, s.lab] as const));
    for (const hex of [RED, BLUE]) {
      const expected = rgbToLab(hexToRgb(hex));
      const lab: Lab = byHex.get(hex) ?? [Number.NaN, 0, 0];
      expect(lab[0]).toBeCloseTo(expected[0], 6);
      expect(lab[1]).toBeCloseTo(expected[1], 6);
      expect(lab[2]).toBeCloseTo(expected[2], 6);
    }
  });

  it('gives one swatch with share 1 for a single-colour image', () => {
    const swatches = extractPalette(solidImage(8, 8, hexToRgb(GREEN)), { k: 6 });
    expect(swatches).toHaveLength(1);
    expect(swatches[0]?.hex).toBe(GREEN);
    expect(swatches[0]?.share).toBeCloseTo(1, 9);
  });

  it('handles a single-pixel image', () => {
    const swatches = extractPalette(solidImage(1, 1, hexToRgb(RED)), { k: 4 });
    expect(hexes(swatches)).toEqual([RED]);
    expect(swatches[0]?.share).toBeCloseTo(1, 9);
  });

  it('with k=1 collapses a two-colour image into one swatch of share 1', () => {
    const swatches = extractPalette(checkerboard(RED, BLUE, 16), { k: 1 });
    expect(swatches).toHaveLength(1);
    expect(swatches[0]?.share).toBeCloseTo(1, 9);
  });

  it('orders three colours by area share (70/20/10) with those shares', () => {
    const image = bands(10, [
      { hex: BLUE, rows: 2 },
      { hex: GREEN, rows: 1 },
      { hex: RED, rows: 7 },
    ]);
    const swatches = extractPalette(image, { k: 6 });
    expect(hexes(swatches)).toEqual([RED, BLUE, GREEN]);
    expect(swatches[0]?.share).toBeCloseTo(0.7, 9);
    expect(swatches[1]?.share).toBeCloseTo(0.2, 9);
    expect(swatches[2]?.share).toBeCloseTo(0.1, 9);
  });

  it('returns no duplicates when k is greater than the number of distinct colours', () => {
    const image = bands(4, [
      { hex: RED, rows: 3 },
      { hex: BLUE, rows: 2 },
      { hex: GREEN, rows: 1 },
    ]);
    const swatches = extractPalette(image, { k: 8 });
    expect(swatches).toHaveLength(3);
    expect(new Set(hexes(swatches)).size).toBe(3);
  });

  it('gives k swatches when there are at least k clearly different colours', () => {
    const colours = ['#C0392B', '#2E86C1', '#27AE60', '#F1C40F', '#8E44AD'];
    const image = bands(
      10,
      colours.map((hex, i) => ({ hex, rows: i + 1 })),
    );
    expect(extractPalette(image, { k: 4 })).toHaveLength(4);
    expect(extractPalette(image, { k: 5 })).toHaveLength(5);
  });

  it('samples a 1,000,000-pixel image and still finds both halves', () => {
    const left = hexToRgb(RED);
    const right = hexToRgb(BLUE);
    const image = buildImage(1000, 1000, (x) => ({ rgb: x < 500 ? left : right }));
    expect(sampleLabPixels(image).length / 3).toBeLessThanOrEqual(40_000);
    const swatches = extractPalette(image, { k: 6 });
    expect(hexes(swatches).sort()).toEqual([BLUE, RED]);
    for (const s of swatches) {
      expect(Math.abs(s.share - 0.5)).toBeLessThan(0.02);
    }
  });
});

describe('extractPalette: transparency', () => {
  it('returns an empty palette for an all-transparent image', () => {
    expect(extractPalette(solidImage(6, 6, hexToRgb(RED), 0), { k: 5 })).toEqual([]);
  });

  it('returns an empty palette for an empty image', () => {
    expect(extractPalette({ data: new Uint8ClampedArray(0), width: 0, height: 0 }, { k: 5 })).toEqual([]);
  });

  it('does not count transparent pixels toward shares', () => {
    const red = hexToRgb(RED);
    const blue = hexToRgb(BLUE);
    const green = hexToRgb(GREEN);
    // rows 0-1 red (opaque), row 2 blue (opaque), rows 3-6 green but transparent
    const image = buildImage(10, 7, (_x, y) => {
      if (y < 2) return { rgb: red };
      if (y < 3) return { rgb: blue };
      return { rgb: green, alpha: 0 };
    });
    const swatches = extractPalette(image, { k: 6 });
    expect(hexes(swatches)).toEqual([RED, BLUE]);
    expect(swatches[0]?.share).toBeCloseTo(2 / 3, 9);
    expect(swatches[1]?.share).toBeCloseTo(1 / 3, 9);
  });

  it('ignores pixels at alpha 127 and counts pixels at alpha 128', () => {
    const red = hexToRgb(RED);
    const blue = hexToRgb(BLUE);
    const image = buildImage(10, 10, (_x, y) => (y < 5 ? { rgb: red, alpha: 128 } : { rgb: blue, alpha: 127 }));
    const swatches = extractPalette(image, { k: 6 });
    expect(hexes(swatches)).toEqual([RED]);
    expect(swatches[0]?.share).toBeCloseTo(1, 9);
  });
});

describe('extractPalette: merging near-duplicates', () => {
  it('merges two colours less than deltaE 5 apart into one count-weighted swatch, leaving a different colour alone', () => {
    const base = hexToRgb(RED);
    const near = partnerAtLeast(base, 2);
    const dE = deltaE2000(rgbToLab(base), rgbToLab(near));
    expect(dE).toBeGreaterThan(0);
    expect(dE).toBeLessThan(5);
    expect(rgbToHex(near)).not.toBe(RED);

    const far = hexToRgb(BLUE);
    // 120 base + 80 near + 100 far: merged swatch has 200 of 300 pixels
    const image = buildImage(300, 1, (x) => {
      if (x < 120) return { rgb: base };
      if (x < 200) return { rgb: near };
      return { rgb: far };
    });
    const swatches = extractPalette(image, { k: 6 });
    expect(swatches).toHaveLength(2);
    expect(swatches[0]?.share).toBeCloseTo(2 / 3, 9);
    expect(swatches[1]?.share).toBeCloseTo(1 / 3, 9);
    expect(swatches[1]?.hex).toBe(BLUE);

    const lb = rgbToLab(base);
    const ln = rgbToLab(near);
    const mean: Lab = [0.6 * lb[0] + 0.4 * ln[0], 0.6 * lb[1] + 0.4 * ln[1], 0.6 * lb[2] + 0.4 * ln[2]];
    expect(swatches[0]?.hex).toBe(rgbToHex(labToRgb(mean)));
    expect(swatches[0]?.lab[0]).toBeCloseTo(mean[0], 6);
    expect(swatches[0]?.lab[1]).toBeCloseTo(mean[1], 6);
    expect(swatches[0]?.lab[2]).toBeCloseTo(mean[2], 6);
  });

  it('keeps two colours apart when they are more than deltaE 5 apart', () => {
    const base = hexToRgb(RED);
    const apart = partnerAtLeast(base, 5.2);
    expect(deltaE2000(rgbToLab(base), rgbToLab(apart))).toBeGreaterThanOrEqual(5);
    const swatches = extractPalette(mixImage(base, 60, apart, 40), { k: 6 });
    expect(swatches).toHaveLength(2);
    expect(swatches[0]?.share).toBeCloseTo(0.6, 9);
    expect(swatches[1]?.share).toBeCloseTo(0.4, 9);
  });

  it('merges a pair just under the threshold', () => {
    const base = hexToRgb(GREEN);
    const near = partnerAtLeast(base, 4.4);
    const dE = deltaE2000(rgbToLab(base), rgbToLab(near));
    expect(dE).toBeLessThan(5);
    expect(extractPalette(mixImage(base, 50, near, 50), { k: 6 })).toHaveLength(1);
  });
});

describe('extractPalette: validation, options and stopping', () => {
  const image = checkerboard(RED, BLUE, 4);

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('throws RangeError for k = %s', (k) => {
    expect(() => extractPalette(image, { k })).toThrow(RangeError);
    expect(() => extractPaletteFromSamples(sampleLabPixels(image), { k })).toThrow(RangeError);
  });

  it('accepts k = 1', () => {
    expect(extractPalette(image, { k: 1 })).toHaveLength(1);
  });

  it('uses the default seed when none is given', () => {
    const photo = buildImage(12, 12, (x, y) => ({ rgb: [x * 20, y * 20, (x * y) % 256] as Rgb }));
    expect(extractPalette(photo, { k: 5 })).toEqual(extractPalette(photo, { k: 5, seed: DEFAULT_SEED }));
  });

  it('is deterministic for the same seed', () => {
    const photo = buildImage(12, 12, (x, y) => ({ rgb: [x * 20, y * 20, (x * y) % 256] as Rgb }));
    expect(extractPalette(photo, { k: 5, seed: 99 })).toEqual(extractPalette(photo, { k: 5, seed: 99 }));
  });

  it('returns null from extractPaletteFromSamples when shouldStop is true', () => {
    expect(extractPaletteFromSamples(sampleLabPixels(image), { k: 4, shouldStop: () => true })).toBeNull();
  });

  it('returns a palette from extractPaletteFromSamples when shouldStop is false', () => {
    const swatches = extractPaletteFromSamples(sampleLabPixels(image), { k: 4, shouldStop: () => false });
    expect(hexes(swatches ?? [])).toEqual([BLUE, RED]);
  });

  it('returns an empty list for empty samples', () => {
    expect(extractPaletteFromSamples(new Float64Array(0), { k: 4 })).toEqual([]);
  });

  it('matches extractPalette when fed the sampled pixels', () => {
    expect(extractPaletteFromSamples(sampleLabPixels(image), { k: 4 })).toEqual(extractPalette(image, { k: 4 }));
  });
});

describe('extractPalette: properties', () => {
  const pixelArb = fc.tuple(
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
  );
  const imageArb = fc
    .tuple(fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 8 }))
    .chain(([w, h]) =>
      fc.tuple(fc.constant(w), fc.constant(h), fc.array(pixelArb, { minLength: w * h, maxLength: w * h })),
    )
    .map(([width, height, px]) => buildImage(width, height, (x, y) => ({ rgb: px[y * width + x] ?? [0, 0, 0] })));
  const kArb = fc.integer({ min: 1, max: 8 });
  const RUNS = { seed: 42, numRuns: 200 } as const;

  it('shares sum to 1 and are sorted in descending order', () => {
    fc.assert(
      fc.property(imageArb, kArb, (image, k) => {
        const swatches = extractPalette(image, { k });
        expect(swatches.reduce((s, sw) => s + sw.share, 0)).toBeCloseTo(1, 9);
        for (let i = 1; i < swatches.length; i++) {
          expect(swatches[i - 1]?.share ?? 0).toBeGreaterThanOrEqual(swatches[i]?.share ?? 1);
        }
      }),
      RUNS,
    );
  });

  it('gives uppercase #RRGGBB hexes that are unique, with shares in 0..1, and no more than k swatches', () => {
    fc.assert(
      fc.property(imageArb, kArb, (image, k) => {
        const swatches = extractPalette(image, { k });
        expect(swatches.length).toBeGreaterThanOrEqual(1);
        expect(swatches.length).toBeLessThanOrEqual(k);
        expect(new Set(hexes(swatches)).size).toBe(swatches.length);
        for (const s of swatches) {
          expect(s.hex).toMatch(/^#[0-9A-F]{6}$/);
          expect(s.share).toBeGreaterThan(0);
          expect(s.share).toBeLessThanOrEqual(1);
        }
      }),
      RUNS,
    );
  });

  it('breaks share ties by hex ascending', () => {
    fc.assert(
      fc.property(imageArb, kArb, (image, k) => {
        const swatches = extractPalette(image, { k });
        for (let i = 1; i < swatches.length; i++) {
          const prev = swatches[i - 1];
          const cur = swatches[i];
          if (prev && cur && prev.share === cur.share) {
            expect(prev.hex < cur.hex).toBe(true);
          }
        }
      }),
      RUNS,
    );
  });

  it('is deterministic for the same image, k and seed', () => {
    fc.assert(
      fc.property(imageArb, kArb, fc.integer({ min: 0, max: 1000 }), (image, k, seed) => {
        expect(extractPalette(image, { k, seed })).toEqual(extractPalette(image, { k, seed }));
      }),
      RUNS,
    );
  });

  it('keeps swatches at least deltaE 5 apart after merging', () => {
    fc.assert(
      fc.property(imageArb, kArb, (image, k) => {
        const swatches = extractPalette(image, { k });
        for (let i = 0; i < swatches.length; i++) {
          for (let j = i + 1; j < swatches.length; j++) {
            const a = swatches[i]?.lab ?? [0, 0, 0];
            const b = swatches[j]?.lab ?? [0, 0, 0];
            expect(deltaE2000(a, b)).toBeGreaterThanOrEqual(MERGE_DELTA_E);
          }
        }
      }),
      RUNS,
    );
  });
});
