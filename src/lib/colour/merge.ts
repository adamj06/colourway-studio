import { at } from './at';
import { deltaE2000 } from './delta-e';
import type { Lab } from './types';

export type Cluster = { lab: Lab; count: number };

type Pair = { i: number; j: number; distance: number };

function closestPair(clusters: readonly Cluster[]): Pair | null {
  let best: Pair | null = null;
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const distance = deltaE2000(at(clusters, i).lab, at(clusters, j).lab);
      if (best === null || distance < best.distance) best = { i, j, distance };
    }
  }
  return best;
}

function combine(a: Cluster, b: Cluster): Cluster {
  const count = a.count + b.count;
  const mix = (x: number, y: number) => (x * a.count + y * b.count) / count;
  return { lab: [mix(a.lab[0], b.lab[0]), mix(a.lab[1], b.lab[1]), mix(a.lab[2], b.lab[2])], count };
}

/**
 * Repeatedly merges the closest pair whose CIEDE2000 difference is strictly below `threshold`
 * into their count-weighted mean, so near-duplicate swatches never appear. The input is not modified.
 */
export function mergeClusters(clusters: readonly Cluster[], threshold: number): Cluster[] {
  const result = [...clusters];
  for (;;) {
    const pair = closestPair(result);
    if (pair === null || pair.distance >= threshold) return result;
    result[pair.i] = combine(at(result, pair.i), at(result, pair.j));
    result.splice(pair.j, 1);
  }
}
