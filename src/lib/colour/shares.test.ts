import { describe, expect, it } from 'vitest';

import { mulberry32 } from './prng';
import { swatchShares } from './shares';
import type { Lab } from './types';

const flat = (labs: Lab[]) => Float64Array.from(labs.flat());
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Brute-force reference, written independently: nearest by squared distance, first (lowest index) wins ties. */
function reference(samples: Float64Array, labs: ReadonlyArray<Lab>): number[] {
  const counts = labs.map(() => 0);
  let total = 0;
  for (let i = 0; i + 2 < samples.length; i += 3) {
    const p = [samples[i] ?? 0, samples[i + 1] ?? 0, samples[i + 2] ?? 0];
    let best = 0;
    let bestD = Infinity;
    labs.forEach((s, j) => {
      const d = ((p[0] ?? 0) - s[0]) ** 2 + ((p[1] ?? 0) - s[1]) ** 2 + ((p[2] ?? 0) - s[2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    });
    counts[best] = (counts[best] ?? 0) + 1;
    total++;
  }
  return counts.map((c) => (total === 0 ? 0 : c / total));
}

const ORIGIN: Lab = [0, 0, 0];

describe('swatchShares: hand-derived dataset', () => {
  // Swatches: S0=[0,0,0], S1=[10,0,0], S2=[0,10,0]. Squared distances d0/d1/d2 per sample:
  //  1 [1,0,0]  1/81/101     -> S0
  //  2 [2,1,0]  5/65/85      -> S0
  //  3 [4,0,0]  16/36/116    -> S0
  //  4 [5,0,0]  25/25/125    -> tie S0,S1 -> lower index S0
  //  5 [9,0,0]  81/1/181     -> S1
  //  6 [11,1,0] 122/2/222    -> S1
  //  7 [8,2,0]  68/8/128     -> S1
  //  8 [0,9,0]  81/181/1     -> S2
  //  9 [1,8,1]  66/146/6     -> S2
  // 10 [0,6,0]  36/136/16    -> S2
  // Counts 4/3/3 of 10.
  const labs: Lab[] = [ORIGIN, [10, 0, 0], [0, 10, 0]];
  const samples: Lab[] = [
    [1, 0, 0],
    [2, 1, 0],
    [4, 0, 0],
    [5, 0, 0],
    [9, 0, 0],
    [11, 1, 0],
    [8, 2, 0],
    [0, 9, 0],
    [1, 8, 1],
    [0, 6, 0],
  ];

  it('gives 0.4, 0.3, 0.3 for the ten-sample, three-swatch dataset', () => {
    const out = swatchShares(flat(samples), labs);
    expect(out).toHaveLength(3);
    expect(out[0]).toBeCloseTo(0.4, 12);
    expect(out[1]).toBeCloseTo(0.3, 12);
    expect(out[2]).toBeCloseTo(0.3, 12);
  });

  it('gives the same shares when the samples are reversed (order does not matter)', () => {
    const out = swatchShares(flat([...samples].reverse()), labs);
    expect(out[0]).toBeCloseTo(0.4, 12);
    expect(out[1]).toBeCloseTo(0.3, 12);
    expect(out[2]).toBeCloseTo(0.3, 12);
  });
});

describe('swatchShares: edges', () => {
  it('counts a sample that is the very last one (no off-by-one at the end of the samples)', () => {
    const out = swatchShares(flat([ORIGIN, ORIGIN, [100, 0, 0]]), [ORIGIN, [100, 0, 0]]);
    expect(out[0]).toBeCloseTo(2 / 3, 12);
    expect(out[1]).toBeCloseTo(1 / 3, 12);
  });

  it('counts a sample that is the very first one (no off-by-one at the start of the samples)', () => {
    const out = swatchShares(flat([[100, 0, 0], ORIGIN, ORIGIN]), [ORIGIN, [100, 0, 0]]);
    expect(out[0]).toBeCloseTo(2 / 3, 12);
    expect(out[1]).toBeCloseTo(1 / 3, 12);
  });

  it('can give all the pixels to the last swatch (no off-by-one at the end of the swatches)', () => {
    expect(
      swatchShares(
        flat([
          [90, 0, 0],
          [95, 0, 0],
        ]),
        [ORIGIN, [50, 0, 0], [100, 0, 0]],
      ),
    ).toEqual([0, 0, 1]);
  });

  it('can give all the pixels to the first swatch', () => {
    expect(
      swatchShares(
        flat([
          [1, 0, 0],
          [2, 0, 0],
        ]),
        [ORIGIN, [50, 0, 0], [100, 0, 0]],
      ),
    ).toEqual([1, 0, 0]);
  });

  it('sends a pixel exactly midway between two swatches to the lower index', () => {
    expect(swatchShares(flat([[5, 0, 0]]), [ORIGIN, [10, 0, 0]])).toEqual([1, 0]);
  });

  it('sends a midway pixel to the lower index when the lower index is the farther-out listed swatch', () => {
    expect(swatchShares(flat([[5, 0, 0]]), [[10, 0, 0], ORIGIN])).toEqual([1, 0]);
  });

  it('gives a swatch that no pixel is nearest to a share of exactly 0', () => {
    expect(
      swatchShares(
        flat([
          [0, 0, 0],
          [1, 0, 0],
        ]),
        [ORIGIN, [500, 500, 500]],
      ),
    ).toEqual([1, 0]);
  });

  it('gives duplicate swatches to the lower index and 0 to the repeats', () => {
    expect(
      swatchShares(
        flat([
          [1, 1, 1],
          [2, 2, 2],
        ]),
        [ORIGIN, ORIGIN, ORIGIN],
      ),
    ).toEqual([1, 0, 0]);
  });

  it('returns all zeros, not NaN, when there are no samples', () => {
    const out = swatchShares(new Float64Array(0), [ORIGIN, [1, 1, 1]]);
    expect(out).toEqual([0, 0]);
    expect(out.some(Number.isNaN)).toBe(false);
  });

  it('returns an empty array for no swatches', () => {
    expect(swatchShares(flat([[1, 2, 3]]), [])).toEqual([]);
  });

  it('returns an empty array for no swatches and no samples', () => {
    expect(swatchShares(new Float64Array(0), [])).toEqual([]);
  });

  it('gives a single swatch the whole share', () => {
    expect(
      swatchShares(
        flat([
          [1, 2, 3],
          [4, 5, 6],
        ]),
        [[50, 50, 50]],
      ),
    ).toEqual([1]);
  });

  it('ignores a trailing partial triple and divides by the whole samples only', () => {
    // 2 whole samples ([0,0,0] -> S0, [10,0,0] -> S1) plus two stray numbers that would count if read as a third.
    const samples = Float64Array.of(0, 0, 0, 10, 0, 0, 10, 0);
    expect(swatchShares(samples, [ORIGIN, [10, 0, 0]])).toEqual([0.5, 0.5]);
  });

  it('returns zeros when the samples hold only a partial triple', () => {
    expect(swatchShares(Float64Array.of(1, 2), [ORIGIN, [1, 1, 1]])).toEqual([0, 0]);
  });

  it('weighs by count over total, not the other way round', () => {
    // 1 of 4 pixels is nearest S1, so S1 is 0.25 and S0 is 0.75.
    expect(swatchShares(flat([ORIGIN, ORIGIN, ORIGIN, [9, 0, 0]]), [ORIGIN, [10, 0, 0]])).toEqual([0.75, 0.25]);
  });

  it('does not mutate its inputs', () => {
    const s = flat([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    const copy = Float64Array.from(s);
    const labs: Lab[] = [ORIGIN, [9, 9, 9]];
    swatchShares(s, labs);
    expect(s).toEqual(copy);
    expect(labs).toEqual([ORIGIN, [9, 9, 9]]);
  });
});

describe('swatchShares: properties against a brute-force reference', () => {
  const spread = (rng: () => number, scale: number) => (rng() - 0.5) * scale;

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('matches the reference, sums to 1 and stays in [0,1] (seed %i)', (seed) => {
    const rng = mulberry32(seed);
    const k = 1 + Math.floor(rng() * 8);
    const n = 1 + Math.floor(rng() * 300);
    const labs: Lab[] = Array.from({ length: k }, () => [rng() * 100, spread(rng, 200), spread(rng, 200)]);
    const samples = Float64Array.from({ length: n * 3 }, (_, i) => (i % 3 === 0 ? rng() * 100 : spread(rng, 200)));
    const out = swatchShares(samples, labs);
    const ref = reference(samples, labs);
    expect(out).toHaveLength(k);
    out.forEach((v, i) => {
      expect(v).toBeCloseTo(ref[i] ?? Number.NaN, 12);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });
    expect(Math.abs(sum(out) - 1)).toBeLessThan(1e-12);
  });

  it.each([11, 12, 13, 14, 15])('matches the reference on a lattice full of exact ties (seed %i)', (seed) => {
    const rng = mulberry32(seed);
    const labs: Lab[] = Array.from({ length: 5 }, () => [
      Math.floor(rng() * 4) * 10,
      Math.floor(rng() * 4) * 10,
      Math.floor(rng() * 4) * 10,
    ]);
    const samples = Float64Array.from({ length: 600 }, () => Math.floor(rng() * 9) * 5);
    const out = swatchShares(samples, labs);
    const ref = reference(samples, labs);
    out.forEach((v, i) => {
      expect(v).toBeCloseTo(ref[i] ?? Number.NaN, 12);
    });
  });

  it('is invariant under shuffling the samples', () => {
    const rng = mulberry32(99);
    const labs: Lab[] = [
      [20, 0, 0],
      [50, 30, -30],
      [80, -20, 40],
    ];
    const triples: Lab[] = Array.from({ length: 100 }, () => [rng() * 100, spread(rng, 100), spread(rng, 100)]);
    const shuffled = [...triples].sort(() => rng() - 0.5);
    const a = swatchShares(flat(triples), labs);
    const b = swatchShares(flat(shuffled), labs);
    a.forEach((v, i) => {
      expect(v).toBeCloseTo(b[i] ?? Number.NaN, 12);
    });
  });
});
