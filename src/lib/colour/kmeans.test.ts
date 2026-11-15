import { describe, expect, it } from 'vitest';

import { kmeansLab, MAX_ITERATIONS } from './kmeans';
import { mulberry32 } from './prng';

type P = readonly [number, number, number];

function flat(points: readonly P[]): Float64Array {
  return Float64Array.from(points.flat());
}

function centroidList(centroids: Float64Array): P[] {
  const out: P[] = [];
  for (let i = 0; i < centroids.length; i += 3) {
    out.push([centroids[i] ?? Number.NaN, centroids[i + 1] ?? Number.NaN, centroids[i + 2] ?? Number.NaN]);
  }
  return out;
}

function dist2(a: P, b: P): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

/** Deterministic noisy points (test input, not reference data), spread over a Lab-like box. */
function noisy(n: number, seed = 3): Float64Array {
  const rng = mulberry32(seed);
  const pts: P[] = [];
  for (let i = 0; i < n; i++) {
    pts.push([rng() * 100, rng() * 100 - 50, rng() * 100 - 50]);
  }
  return flat(pts);
}

function inertia(samples: Float64Array, centroids: Float64Array): number {
  const cs = centroidList(centroids);
  let total = 0;
  for (let i = 0; i < samples.length; i += 3) {
    const p: P = [samples[i] ?? 0, samples[i + 1] ?? 0, samples[i + 2] ?? 0];
    total += Math.min(...cs.map((c) => dist2(p, c)));
  }
  return total;
}

function assignToNearest(samples: Float64Array, cs: readonly P[]): P[][] {
  const groups: P[][] = cs.map(() => []);
  for (let i = 0; i < samples.length; i += 3) {
    const p: P = [samples[i] ?? 0, samples[i + 1] ?? 0, samples[i + 2] ?? 0];
    const d = cs.map((c) => dist2(p, c));
    groups[d.indexOf(Math.min(...d))]?.push(p);
  }
  return groups;
}

function meanOf(points: readonly P[]): P {
  const n = Math.max(points.length, 1);
  const sum = points.reduce<P>((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]);
  return [sum[0] / n, sum[1] / n, sum[2] / n];
}

const CENTRES: P[] = [
  [20, 40, 30],
  [60, -40, 10],
  [90, 5, -60],
];

/** Three tight, far-apart clusters of 10 points each (small deterministic jitter). */
function threeClusters(): Float64Array {
  const pts: P[] = [];
  CENTRES.forEach((c) => {
    for (let i = 0; i < 10; i++) {
      pts.push([c[0] + (i % 3) * 0.1, c[1] + (i % 2) * 0.1, c[2] - (i % 5) * 0.05]);
    }
  });
  return flat(pts);
}

describe('kmeansLab', () => {
  it('defaults to a 20 iteration cap', () => {
    expect(MAX_ITERATIONS).toBe(20);
  });

  it('returns empty centroids, no counts and zero iterations for empty samples', () => {
    const result = kmeansLab(new Float64Array(0), 3, mulberry32(1));
    expect(result).not.toBeNull();
    expect(result?.centroids).toHaveLength(0);
    expect(result?.counts).toEqual([]);
    expect(result?.iterations).toBe(0);
  });

  it('with k=1 returns the mean of all samples as the single centroid', () => {
    const points: P[] = [
      [10, 0, 0],
      [20, 0, 0],
      [30, 6, -9],
    ];
    const result = kmeansLab(flat(points), 1, mulberry32(1));
    expect(result?.counts).toEqual([3]);
    expect(result?.centroids).toHaveLength(3);
    expect(result?.centroids[0]).toBeCloseTo(20, 9);
    expect(result?.centroids[1]).toBeCloseTo(2, 9);
    expect(result?.centroids[2]).toBeCloseTo(-3, 9);
  });

  it('handles a single sample', () => {
    const result = kmeansLab(flat([[40, 10, -10]]), 4, mulberry32(1));
    expect(result?.counts).toEqual([1]);
    expect(Array.from(result?.centroids ?? [])).toEqual([40, 10, -10]);
  });

  it('finds three well separated clusters of ten points each', () => {
    const samples = threeClusters();
    const result = kmeansLab(samples, 3, mulberry32(7));
    expect(result).not.toBeNull();
    expect([...(result?.counts ?? [])].sort((a, b) => a - b)).toEqual([10, 10, 10]);
    const found = centroidList(result?.centroids ?? new Float64Array(0));
    for (const c of CENTRES) {
      const nearest = Math.min(...found.map((f) => dist2(f, c)));
      expect(nearest).toBeLessThan(1);
    }
  });

  it('pairs each count with the centroid at the same index', () => {
    const points: P[] = [];
    for (let i = 0; i < 3; i++) points.push([10, 0, 0]);
    for (let i = 0; i < 7; i++) points.push([80, 30, 30]);
    const result = kmeansLab(flat(points), 2, mulberry32(2));
    const cs = centroidList(result?.centroids ?? new Float64Array(0));
    cs.forEach((c, i) => {
      const expectedCount = c[0] < 50 ? 3 : 7;
      expect(result?.counts[i]).toBe(expectedCount);
    });
  });

  it('converges before the iteration cap on easy data', () => {
    const result = kmeansLab(threeClusters(), 3, mulberry32(7));
    expect(result?.iterations).toBeGreaterThanOrEqual(1);
    expect(result?.iterations).toBeLessThan(MAX_ITERATIONS);
  });

  it('returns one centroid per count, and counts add up to the number of samples', () => {
    const samples = noisy(200);
    const result = kmeansLab(samples, 6, mulberry32(11));
    expect(result).not.toBeNull();
    expect((result?.centroids.length ?? 0) / 3).toBe(result?.counts.length);
    expect(result?.counts.reduce((a, b) => a + b, 0)).toBe(200);
    expect(result?.counts.every((c) => c > 0)).toBe(true);
    expect(result?.counts.length).toBeLessThanOrEqual(6);
  });

  it('yields fewer clusters than k when there are fewer distinct points, with no empties or duplicates', () => {
    const points: P[] = [];
    for (let i = 0; i < 6; i++) points.push([10, 0, 0]);
    for (let i = 0; i < 4; i++) points.push([70, 20, -20]);
    const result = kmeansLab(flat(points), 5, mulberry32(4));
    expect(result?.counts).toHaveLength(2);
    expect([...(result?.counts ?? [])].sort((a, b) => a - b)).toEqual([4, 6]);
    const cs = centroidList(result?.centroids ?? new Float64Array(0));
    expect(new Set(cs.map((c) => c.join(','))).size).toBe(2);
  });

  it('collapses to one cluster when every sample is identical', () => {
    const points: P[] = Array.from({ length: 12 }, () => [55, 5, 5] as P);
    const result = kmeansLab(flat(points), 3, mulberry32(4));
    expect(result?.counts).toEqual([12]);
    expect(Array.from(result?.centroids ?? [])).toEqual([55, 5, 5]);
  });

  it('never makes more clusters than there are samples', () => {
    const result = kmeansLab(
      flat([
        [10, 0, 0],
        [50, 10, 10],
      ]),
      5,
      mulberry32(4),
    );
    expect(result?.counts).toEqual([1, 1]);
  });

  it('survives degenerate random sources', () => {
    const samples = threeClusters();
    for (const rng of [() => 0, () => 0.999_999_999, () => 0.5]) {
      const result = kmeansLab(samples, 3, rng);
      expect(result?.counts.reduce((a, b) => a + b, 0)).toBe(30);
      expect(result?.counts.every((c) => c > 0)).toBe(true);
    }
  });

  it('gives identical results for the same samples and seed', () => {
    const samples = noisy(150);
    const a = kmeansLab(samples, 5, mulberry32(9));
    const b = kmeansLab(samples, 5, mulberry32(9));
    expect(a).toEqual(b);
  });

  it('does not modify the input samples', () => {
    const samples = noisy(60);
    const copy = new Float64Array(samples);
    kmeansLab(samples, 4, mulberry32(1));
    expect(samples).toEqual(copy);
  });

  it('returns null when shouldStop is true from the start', () => {
    expect(kmeansLab(noisy(50), 3, mulberry32(1), { shouldStop: () => true })).toBeNull();
  });

  it('checks shouldStop before each iteration and runs on when it stays false', () => {
    let calls = 0;
    const result = kmeansLab(noisy(200), 6, mulberry32(1), {
      shouldStop: () => {
        calls += 1;
        return false;
      },
    });
    expect(result).not.toBeNull();
    expect(calls).toBe(result?.iterations);
  });

  it('returns null when shouldStop turns true after the first iteration', () => {
    const samples = noisy(300);
    const baseline = kmeansLab(samples, 6, mulberry32(1));
    expect(baseline?.iterations).toBeGreaterThanOrEqual(2);
    let calls = 0;
    const result = kmeansLab(samples, 6, mulberry32(1), {
      shouldStop: () => {
        calls += 1;
        return calls > 1;
      },
    });
    expect(result).toBeNull();
  });

  it('stops after maxIterations even if not converged', () => {
    const samples = noisy(300);
    const baseline = kmeansLab(samples, 6, mulberry32(1));
    expect(baseline?.iterations).toBeGreaterThanOrEqual(2);
    const one = kmeansLab(samples, 6, mulberry32(1), { maxIterations: 1 });
    expect(one?.iterations).toBe(1);
    const two = kmeansLab(samples, 6, mulberry32(1), { maxIterations: 2 });
    expect(two?.iterations).toBeLessThanOrEqual(2);
    expect(baseline?.iterations).toBeLessThanOrEqual(MAX_ITERATIONS);
  });

  it('improves (never worsens) the fit as Lloyd iterations proceed', () => {
    const samples = noisy(300);
    const one = kmeansLab(samples, 6, mulberry32(1), { maxIterations: 1 });
    const full = kmeansLab(samples, 6, mulberry32(1));
    expect(inertia(samples, full?.centroids ?? new Float64Array(0))).toBeLessThan(
      inertia(samples, one?.centroids ?? new Float64Array(0)),
    );
  });

  it('puts each centroid at the mean of its members after convergence', () => {
    const samples = threeClusters();
    const result = kmeansLab(samples, 3, mulberry32(5));
    const cs = centroidList(result?.centroids ?? new Float64Array(0));
    const groups = assignToNearest(samples, cs);
    cs.forEach((c, i) => {
      const members = groups[i] ?? [];
      const mean = meanOf(members);
      expect(c[0]).toBeCloseTo(mean[0], 9);
      expect(c[1]).toBeCloseTo(mean[1], 9);
      expect(c[2]).toBeCloseTo(mean[2], 9);
      expect(result?.counts[i]).toBe(members.length);
    });
  });
});
