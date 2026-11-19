// Regression tests for issue #19: the palette must show k swatches when the design has at least k clearly different
// colours, even if k-means at exactly k puts several centres inside a family of near-identical shades and the merge
// step then collapses them. All data is synthetic and built here.

import { describe, expect, it } from 'vitest';

import { buildImage } from '../../../tests/helpers/colour';
import { labToRgb, rgbToHex } from './convert';
import { deltaE2000 } from './delta-e';
import { kmeansLabToEnd } from './kmeans';
import { mergeClusters, type Cluster } from './merge';
import * as palette from './palette';
import { extractPalette, extractPaletteFromSamples, MERGE_DELTA_E } from './palette';
import { mulberry32 } from './prng';
import { sampleLabPixels } from './sample';
import type { Lab, Rgb, Swatch } from './types';

/** Eight widely separated colours (every pair is far more than deltaE 5 apart). */
const DISTINCT: Lab[] = [
  [30, 60, 40],
  [50, -60, 40],
  [80, 0, 80],
  [30, 40, -60],
  [60, 0, -50],
  [92, 0, 0],
  [10, 0, 0],
  [55, 60, -10],
];

/** Ten shades one L* step apart: near-identical to each other, but a big heavy blob that attracts k-means centres. */
const SHADES: Lab[] = Array.from({ length: 10 }, (_, i): Lab => [44 + i, 50, 30]);

const SHADE_PIXELS = 1000;
const DISTINCT_PIXELS = 10;
const ORIGIN: Lab = [0, 0, 0];

function distinct(i: number): Lab {
  return DISTINCT[i] ?? ORIGIN;
}

function buildSamples(spec: readonly (readonly [Lab, number])[]): Float64Array {
  const total = spec.reduce((sum, [, count]) => sum + count, 0);
  const out = new Float64Array(total * 3);
  let i = 0;
  for (const [lab, count] of spec) {
    for (let n = 0; n < count; n++) {
      out.set(lab, i * 3);
      i++;
    }
  }
  return out;
}

/** 10 near-identical heavy shades + 8 light distinct colours = 9 clearly different groups. */
function shadesPlusDistinct(): Float64Array {
  return buildSamples([
    ...SHADES.map((lab) => [lab, SHADE_PIXELS] as const),
    ...DISTINCT.map((lab) => [lab, DISTINCT_PIXELS] as const),
  ]);
}

const KS = [4, 5, 6, 7, 8] as const;

function clustersOf(result: { centroids: Float64Array; counts: number[] }): Cluster[] {
  return result.counts.map((count, c) => ({
    lab: [result.centroids[c * 3] ?? 0, result.centroids[c * 3 + 1] ?? 0, result.centroids[c * 3 + 2] ?? 0],
    count,
  }));
}

/** What the code did before the fix: one k-means run at exactly k, then merge. */
function plainMerged(samples: Float64Array, k: number, seed = palette.DEFAULT_SEED): Cluster[] {
  return mergeClusters(clustersOf(kmeansLabToEnd(samples, k, mulberry32(seed))), MERGE_DELTA_E);
}

/** The old output, rebuilt independently of palette.ts, for the "unchanged when the first run is enough" check. */
function plainSwatches(samples: Float64Array, k: number, seed = palette.DEFAULT_SEED): Swatch[] {
  const merged = plainMerged(samples, k, seed);
  const total = merged.reduce((sum, c) => sum + c.count, 0);
  return merged
    .map((c) => ({ hex: rgbToHex(labToRgb(c.lab)), lab: c.lab, share: c.count / total }))
    .sort((a, b) => b.share - a.share || (a.hex < b.hex ? -1 : 1));
}

function assertWellFormed(swatches: readonly Swatch[]): void {
  expect(swatches.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 9);
  for (let i = 1; i < swatches.length; i++) {
    const prev = swatches[i - 1];
    const cur = swatches[i];
    if (prev === undefined || cur === undefined) throw new Error('unreachable');
    expect(prev.share).toBeGreaterThanOrEqual(cur.share);
    if (prev.share === cur.share) expect(prev.hex < cur.hex).toBe(true);
  }
}

function assertNoNearDuplicates(swatches: readonly Swatch[]): void {
  for (let i = 0; i < swatches.length; i++) {
    for (let j = i + 1; j < swatches.length; j++) {
      const a = swatches[i]?.lab ?? ORIGIN;
      const b = swatches[j]?.lab ?? ORIGIN;
      expect(deltaE2000(a, b)).toBeGreaterThanOrEqual(MERGE_DELTA_E);
    }
  }
}

describe('top-up fixture sanity (documents the #19 failure mode)', () => {
  it('a single k-means run plus merge returns fewer than k swatches for at least one k in 4..8', () => {
    const samples = shadesPlusDistinct();
    const short = KS.filter((k) => plainMerged(samples, k).length < k);
    // With seed 1 this is k=4 (3 swatches) and k=8 (7 swatches) on the current code.
    expect(short.length).toBeGreaterThan(0);
  });

  it('every pair of the eight distinct colours is far apart', () => {
    for (let i = 0; i < DISTINCT.length; i++) {
      for (let j = i + 1; j < DISTINCT.length; j++) {
        expect(deltaE2000(distinct(i), distinct(j))).toBeGreaterThan(20);
      }
    }
  });
});

describe('extractPaletteFromSamples: exactly k swatches when k clearly different colours exist', () => {
  it.each(KS)('returns exactly %i swatches for the shades-plus-distinct sample set', (k) => {
    expect(extractPaletteFromSamples(shadesPlusDistinct(), { k })).toHaveLength(k);
  });

  it.each([1, 2, 3])('still returns exactly %i swatches for small k', (k) => {
    expect(extractPaletteFromSamples(shadesPlusDistinct(), { k })).toHaveLength(k);
  });

  it.each(KS)('returns exactly %i swatches for several different seeds', (k) => {
    for (const seed of [0, 1, 2, 7, 42, 1234]) {
      expect(extractPaletteFromSamples(shadesPlusDistinct(), { k, seed })).toHaveLength(k);
    }
  });

  it('returns 4 swatches where the plain run returned fewer than 4 (the #19 regression)', () => {
    const samples = shadesPlusDistinct();
    expect(plainMerged(samples, 4).length).toBeLessThan(4);
    expect(extractPaletteFromSamples(samples, { k: 4 })).toHaveLength(4);
  });

  it('returns 8 swatches where the plain run returned fewer than 8 (the #19 regression)', () => {
    const samples = shadesPlusDistinct();
    expect(plainMerged(samples, 8).length).toBeLessThan(8);
    expect(extractPaletteFromSamples(samples, { k: 8 })).toHaveLength(8);
  });
});

describe('extractPalette (pixels): exactly k swatches when k clearly different colours exist', () => {
  // The same colours as an image, one pixel row, so palette extraction goes through sampleLabPixels.
  function image() {
    const colours: Rgb[] = [];
    for (const lab of SHADES) for (let n = 0; n < SHADE_PIXELS; n++) colours.push(labToRgb(lab));
    for (const lab of DISTINCT) for (let n = 0; n < DISTINCT_PIXELS; n++) colours.push(labToRgb(lab));
    return buildImage(colours.length, 1, (x) => ({ rgb: colours[x] ?? [0, 0, 0] }));
  }

  it.each(KS)('returns exactly %i swatches', (k) => {
    expect(extractPalette(image(), { k })).toHaveLength(k);
  });

  it('is the same result as extractPaletteFromSamples on the sampled pixels', () => {
    const img = image();
    for (const k of KS) {
      expect(extractPalette(img, { k })).toEqual(extractPaletteFromSamples(sampleLabPixels(img), { k }));
    }
  });
});

describe('top-up: no near-duplicate swatches', () => {
  it.each(KS)('keeps every pair of the %i swatches at least deltaE 5 apart', (k) => {
    assertNoNearDuplicates(extractPaletteFromSamples(shadesPlusDistinct(), { k }) ?? []);
  });
});

describe('top-up: fewer than k distinct colours', () => {
  it('returns all three colours, and no more, when only three distinct colours exist and k is 8', () => {
    const samples = buildSamples([
      [distinct(0), 300],
      [distinct(1), 200],
      [distinct(2), 100],
    ]);
    const swatches = extractPaletteFromSamples(samples, { k: 8 }) ?? [];
    expect(swatches).toHaveLength(3);
    expect(new Set(swatches.map((s) => s.hex)).size).toBe(3);
    assertWellFormed(swatches);
    expect(swatches[0]?.share).toBeCloseTo(0.5, 9);
    expect(swatches[1]?.share).toBeCloseTo(1 / 3, 9);
    expect(swatches[2]?.share).toBeCloseTo(1 / 6, 9);
  });

  it('returns the largest palette found when a family of near-identical shades collapses to one swatch', () => {
    const tight: Lab[] = [44, 45, 46, 47].map((l): Lab => [l, 50, 30]);
    const samples = buildSamples([...tight.map((lab) => [lab, 200] as const), [distinct(1), 100], [distinct(3), 100]]);
    // 3 clearly different groups, k = 6: the answer is 3 swatches, never more than k, never an error.
    const swatches = extractPaletteFromSamples(samples, { k: 6 }) ?? [];
    expect(swatches).toHaveLength(3);
    assertWellFormed(swatches);
    assertNoNearDuplicates(swatches);
  });

  it('does not throw and never exceeds k when every sample sits in one small blob', () => {
    const rng = mulberry32(5);
    const out = new Float64Array(600 * 3);
    for (let i = 0; i < 600; i++) {
      out[i * 3] = 50 + (rng() - 0.5) * 3;
      out[i * 3 + 1] = 20 + (rng() - 0.5) * 3;
      out[i * 3 + 2] = 20 + (rng() - 0.5) * 3;
    }
    for (const k of KS) {
      const swatches = extractPaletteFromSamples(out, { k }) ?? [];
      expect(swatches.length).toBeGreaterThanOrEqual(1);
      expect(swatches.length).toBeLessThanOrEqual(k);
      assertWellFormed(swatches);
      assertNoNearDuplicates(swatches);
    }
  });

  it('terminates (the top-up is capped) on a smooth gradient of many tiny steps with a large k', () => {
    // 2,000 distinct colours 0.001 L* apart: every run has as many centres as asked, and merging keeps collapsing
    // them, so only the cap stops the loop.
    const n = 2000;
    const out = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      out[i * 3] = 50 + i * 0.001;
      out[i * 3 + 1] = 10;
      out[i * 3 + 2] = 10;
    }
    const swatches = extractPaletteFromSamples(out, { k: 8 }) ?? [];
    expect(swatches.length).toBeGreaterThanOrEqual(1);
    expect(swatches.length).toBeLessThanOrEqual(8);
    assertNoNearDuplicates(swatches);
  });

  it('returns an empty palette for empty samples without throwing', () => {
    expect(extractPaletteFromSamples(new Float64Array(0), { k: 6 })).toEqual([]);
  });

  it.each([0, -1, 1.5, Number.NaN])('still throws RangeError for k = %s', (k) => {
    expect(() => extractPaletteFromSamples(shadesPlusDistinct(), { k })).toThrow(RangeError);
  });
});

describe('top-up: shares, ordering and trimming', () => {
  it.each(KS)('has shares that sum to 1, ordered by share descending then hex, for k=%i', (k) => {
    assertWellFormed(extractPaletteFromSamples(shadesPlusDistinct(), { k }) ?? []);
  });

  it('gives every swatch a positive share and a unique uppercase hex', () => {
    for (const k of KS) {
      const swatches = extractPaletteFromSamples(shadesPlusDistinct(), { k }) ?? [];
      expect(new Set(swatches.map((s) => s.hex)).size).toBe(swatches.length);
      for (const s of swatches) {
        expect(s.hex).toMatch(/^#[0-9A-F]{6}$/);
        expect(s.share).toBeGreaterThan(0);
      }
    }
  });

  it('when the top-up run had more than k clusters, recomputes shares by assigning every sample to its nearest kept swatch', () => {
    // k=4 needs a run at 5 (which gives 5 merged clusters); the extra one is dropped and its pixels reassigned.
    const samples = shadesPlusDistinct();
    expect(plainMerged(samples, 4).length).toBeLessThan(4);
    const swatches = extractPaletteFromSamples(samples, { k: 4 }) ?? [];
    expect(swatches).toHaveLength(4);

    const counts = new Array<number>(swatches.length).fill(0);
    const n = samples.length / 3;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Number.POSITIVE_INFINITY;
      swatches.forEach((s, c) => {
        const dl = (samples[i * 3] ?? 0) - s.lab[0];
        const da = (samples[i * 3 + 1] ?? 0) - s.lab[1];
        const db = (samples[i * 3 + 2] ?? 0) - s.lab[2];
        const d = dl * dl + da * da + db * db;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      });
      counts[best] = (counts[best] ?? 0) + 1;
    }
    swatches.forEach((s, c) => {
      expect(s.share).toBeCloseTo((counts[c] ?? 0) / n, 9);
    });
  });

  it('keeps the heavy shade swatch when trimming to k, rather than the light distinct colours', () => {
    const swatches = extractPaletteFromSamples(shadesPlusDistinct(), { k: 4 }) ?? [];
    // The ten shades are 10,000 of 10,080 pixels, so the biggest swatch sits in the shade family (which may itself
    // legitimately split into two swatches, hence a share below one half is fine).
    const top = swatches[0];
    expect(top).toBeDefined();
    expect(deltaE2000(top?.lab ?? ORIGIN, [48.5, 50, 30])).toBeLessThan(MERGE_DELTA_E * 2);
    expect(top?.share ?? 0).toBeGreaterThan(0.4);
  });
});

describe('top-up: determinism and unchanged behaviour', () => {
  it.each(KS)('is deterministic for the same samples, k and seed (k=%i)', (k) => {
    for (const seed of [1, 9, 77]) {
      expect(extractPaletteFromSamples(shadesPlusDistinct(), { k, seed })).toEqual(
        extractPaletteFromSamples(shadesPlusDistinct(), { k, seed }),
      );
    }
  });

  it('uses the default seed when none is given', () => {
    expect(extractPaletteFromSamples(shadesPlusDistinct(), { k: 4 })).toEqual(
      extractPaletteFromSamples(shadesPlusDistinct(), { k: 4, seed: palette.DEFAULT_SEED }),
    );
  });

  it('equals the single-run result exactly whenever the first run already gives k swatches', () => {
    const samples = shadesPlusDistinct();
    const unaffected = KS.filter((k) => plainMerged(samples, k).length >= k);
    // Guard against a vacuous test: with seed 1 this is k = 5, 6 and 7.
    expect(unaffected.length).toBeGreaterThan(0);
    for (const k of unaffected) {
      expect(extractPaletteFromSamples(samples, { k })).toEqual(plainSwatches(samples, k));
    }
  });

  it('equals the single-run result for an easy sample set at every k up to the number of colours', () => {
    const samples = buildSamples([
      [distinct(0), 50],
      [distinct(1), 30],
      [distinct(4), 20],
    ]);
    for (const k of [1, 2, 3]) {
      expect(extractPaletteFromSamples(samples, { k })).toEqual(plainSwatches(samples, k));
    }
  });
});

describe('top-up cap constant', () => {
  it('exports TOP_UP_FACTOR = 2, so the loop runs k-means at most up to 2 * k', () => {
    expect((palette as Record<string, unknown>)['TOP_UP_FACTOR']).toBe(2);
  });
});
