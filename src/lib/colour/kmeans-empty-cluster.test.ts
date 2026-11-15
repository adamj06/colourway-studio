import { describe, expect, it } from 'vitest';
import { kmeansLab } from './kmeans';
import { mulberry32 } from './prng';

// Found by searching random small 3-D datasets: with this data and seed, Lloyd's moves the centres so that one of
// the 4 seeded clusters loses all its members. The result must drop it, never return an empty or stale cluster.
const POINTS = Float64Array.from([2, 0, 7, 7, 7, 8, 7, 1, 1, 8, 8, 8, 5, 2, 9, 4, 3, 2, 4, 5, 4, 0, 7, 4]);
const SEED = 13;
const K = 4;

function nearest(centroids: Float64Array, point: number[]): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let c = 0; c < centroids.length / 3; c++) {
    const d = [0, 1, 2].reduce((sum, i) => sum + ((point[i] ?? 0) - (centroids[c * 3 + i] ?? 0)) ** 2, 0);
    if (d < bestDistance) {
      bestDistance = d;
      best = c;
    }
  }
  return best;
}

describe('kmeansLab when a cluster loses all its members', () => {
  const result = kmeansLab(POINTS, K, mulberry32(SEED));

  it('returns fewer clusters than requested', () => {
    expect(result.centroids.length / 3).toBeLessThan(K);
  });

  it('never returns an empty cluster, and the counts add up to the number of points', () => {
    expect(result.counts.every((count) => count > 0)).toBe(true);
    expect(result.counts.reduce((a, b) => a + b, 0)).toBe(POINTS.length / 3);
    expect(result.counts).toHaveLength(result.centroids.length / 3);
  });

  it('keeps each centroid at the mean of the points nearest to it', () => {
    const members: number[][][] = result.counts.map(() => []);
    for (let i = 0; i < POINTS.length; i += 3) {
      const point = [POINTS[i] ?? 0, POINTS[i + 1] ?? 0, POINTS[i + 2] ?? 0];
      members[nearest(result.centroids, point)]?.push(point);
    }
    members.forEach((group, c) => {
      expect(group).toHaveLength(result.counts[c] ?? -1);
      for (let d = 0; d < 3; d++) {
        const mean = group.reduce((sum, p) => sum + (p[d] ?? 0), 0) / group.length;
        expect(result.centroids[c * 3 + d]).toBeCloseTo(mean, 9);
      }
    });
  });
});
