import { at } from './at';
import type { Lab } from './types';

/**
 * How much of the design each swatch covers: every sample is counted for its nearest swatch (squared Euclidean
 * distance in CIELAB, the metric k-means uses), and a share is that count over the number of samples. A sample
 * exactly between two swatches goes to the lower index. `samples` is the flat [L, a, b, ...] array from
 * sampleLabPixels; a trailing partial triple is ignored. With no samples every share is 0.
 */
export function swatchShares(samples: Float64Array, labs: readonly Lab[]): number[] {
  if (labs.length === 0) return [];
  const counts = labs.map(() => 0);
  const total = Math.floor(samples.length / 3);
  for (let p = 0; p < total; p++) {
    const l = at(samples, p * 3);
    const a = at(samples, p * 3 + 1);
    const b = at(samples, p * 3 + 2);
    let nearest = 0;
    let best = Infinity;
    for (let s = 0; s < labs.length; s++) {
      const lab = at(labs, s);
      const distance = (l - lab[0]) ** 2 + (a - lab[1]) ** 2 + (b - lab[2]) ** 2;
      if (distance < best) {
        best = distance;
        nearest = s;
      }
    }
    counts[nearest] = at(counts, nearest) + 1;
  }
  return counts.map((count) => (total === 0 ? 0 : count / total));
}
