// k-means in CIELAB with k-means++ seeding and an injected PRNG, so results are deterministic.
// Samples are a flat [L, a, b, L, a, b, ...] array. Distances are Euclidean in Lab (the CIE76 difference).

export const MAX_ITERATIONS = 20;

export type KmeansOptions = {
  maxIterations?: number;
  /** Checked before every iteration; when it returns true the run is abandoned and the result is null. */
  shouldStop?: () => boolean;
};

export type KmeansResult = { centroids: Float64Array; counts: number[]; iterations: number };

function distanceSquared(samples: Float64Array, i: number, centres: Float64Array, c: number): number {
  const dl = (samples[i * 3] ?? 0) - (centres[c * 3] ?? 0);
  const da = (samples[i * 3 + 1] ?? 0) - (centres[c * 3 + 1] ?? 0);
  const db = (samples[i * 3 + 2] ?? 0) - (centres[c * 3 + 2] ?? 0);
  return dl * dl + da * da + db * db;
}

/** Index of the first sample whose running total of weights exceeds `target` (the last positive weight on rounding). */
function pickWeighted(weights: Float64Array, target: number): number {
  let running = 0;
  let lastPositive = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] ?? 0;
    if (w > 0) lastPositive = i;
    running += w;
    if (running > target) return i;
  }
  return lastPositive;
}

/** k-means++: each next centre is a sample chosen with probability proportional to its squared distance to the nearest centre. */
function seedPlusPlus(samples: Float64Array, k: number, rng: () => number): Float64Array {
  const n = samples.length / 3;
  const centres = new Float64Array(k * 3);
  const nearest = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  let chosen = Math.min(n - 1, Math.floor(rng() * n));
  let count = 0;
  for (;;) {
    centres.set(samples.subarray(chosen * 3, chosen * 3 + 3), count * 3);
    count++;
    if (count === k) break;
    let total = 0;
    for (let i = 0; i < n; i++) {
      nearest[i] = Math.min(nearest[i] ?? 0, distanceSquared(samples, i, centres, count - 1));
      total += nearest[i] ?? 0;
    }
    // Every remaining sample coincides with a centre: there are fewer than k distinct colours.
    if (total === 0) break;
    chosen = pickWeighted(nearest, rng() * total);
  }
  return centres.slice(0, count * 3);
}

function nearestCentre(samples: Float64Array, i: number, centres: Float64Array): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let c = 0; c < centres.length / 3; c++) {
    const d = distanceSquared(samples, i, centres, c);
    if (d < bestDistance) {
      bestDistance = d;
      best = c;
    }
  }
  return best;
}

/** Assigns every sample to its nearest centre. Returns true when any assignment changed. */
function assign(samples: Float64Array, centres: Float64Array, assignments: Int32Array): boolean {
  let changed = false;
  for (let i = 0; i < assignments.length; i++) {
    const c = nearestCentre(samples, i, centres);
    if (assignments[i] !== c) {
      assignments[i] = c;
      changed = true;
    }
  }
  return changed;
}

/** Per-cluster sums of Lab values and member counts. */
function accumulate(
  samples: Float64Array,
  assignments: Int32Array,
  k: number,
): { sums: Float64Array; counts: number[] } {
  const sums = new Float64Array(k * 3);
  const counts = new Array<number>(k).fill(0);
  for (let i = 0; i < assignments.length; i++) {
    const c = assignments[i] ?? 0;
    counts[c] = (counts[c] ?? 0) + 1;
    for (let d = 0; d < 3; d++) sums[c * 3 + d] = (sums[c * 3 + d] ?? 0) + (samples[i * 3 + d] ?? 0);
  }
  return { sums, counts };
}

/** Moves each centre to the mean of its members (a centre with no members stays where it is). */
function updateCentres(samples: Float64Array, assignments: Int32Array, centres: Float64Array): number[] {
  const { sums, counts } = accumulate(samples, assignments, centres.length / 3);
  counts.forEach((members, c) => {
    if (members === 0) return;
    for (let d = 0; d < 3; d++) centres[c * 3 + d] = (sums[c * 3 + d] ?? 0) / members;
  });
  return counts;
}

/** Drops centres that ended up with no members, so a result never holds an empty or duplicate cluster. */
function dropEmpty(centres: Float64Array, counts: number[]): { centroids: Float64Array; counts: number[] } {
  const kept = counts.flatMap((count, c) => (count > 0 ? [c] : []));
  const centroids = new Float64Array(kept.length * 3);
  kept.forEach((c, index) => {
    centroids.set(centres.subarray(c * 3, c * 3 + 3), index * 3);
  });
  return { centroids, counts: kept.map((c) => counts[c] ?? 0) };
}

export function kmeansLab(
  samples: Float64Array,
  k: number,
  rng: () => number,
  options: KmeansOptions = {},
): KmeansResult | null {
  const n = samples.length / 3;
  if (n === 0) return { centroids: new Float64Array(0), counts: [], iterations: 0 };

  const { maxIterations = MAX_ITERATIONS, shouldStop } = options;
  const centres = seedPlusPlus(samples, Math.min(k, n), rng);
  const assignments = new Int32Array(n).fill(-1);
  let counts: number[] = [];
  let iterations = 0;
  while (iterations < maxIterations) {
    if (shouldStop?.() === true) return null;
    const changed = assign(samples, centres, assignments);
    counts = updateCentres(samples, assignments, centres);
    iterations++;
    if (!changed) break;
  }
  return { ...dropEmpty(centres, counts), iterations };
}
