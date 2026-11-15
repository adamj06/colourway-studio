export const MAX_ITERATIONS = 20;

export function kmeansLab(
  _samples: Float64Array,
  _k: number,
  _rng: () => number,
  _options?: { maxIterations?: number; shouldStop?: () => boolean },
): { centroids: Float64Array; counts: number[]; iterations: number } | null {
  throw new Error('not implemented', { cause: [_samples, _k, _rng, _options] });
}
