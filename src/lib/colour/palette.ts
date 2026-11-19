import { at } from './at';
import { labToRgb, rgbToHex } from './convert';
import { kmeansLabSteps } from './kmeans';
import { mergeClusters, type Cluster } from './merge';
import { mulberry32 } from './prng';
import { sampleLabPixels } from './sample';
import { swatchShares } from './shares';
import type { PixelBuffer, Swatch } from './types';

/** Clusters closer than this CIEDE2000 difference are merged, so near-duplicate swatches don't appear. */
export const MERGE_DELTA_E = 5;
export const DEFAULT_SEED = 1;

export type PaletteOptions = { k: number; seed?: number };
export type SamplePaletteOptions = PaletteOptions & { shouldStop?: () => boolean };

function assertValidK(k: number): void {
  if (!Number.isInteger(k) || k < 1) throw new RangeError(`k must be an integer of at least 1, got ${String(k)}`);
}

function clustersOf(centroids: Float64Array, counts: number[]): Cluster[] {
  return counts.map((count, c) => ({
    lab: [at(centroids, c * 3), at(centroids, c * 3 + 1), at(centroids, c * 3 + 2)],
    count,
  }));
}

function toSwatches(clusters: Cluster[]): Swatch[] {
  const total = clusters.reduce((sum, c) => sum + c.count, 0);
  return clusters
    .map((c) => ({ hex: rgbToHex(labToRgb(c.lab)), lab: c.lab, share: c.count / total }))
    .sort((a, b) => b.share - a.share || (a.hex < b.hex ? -1 : 1));
}

/** Most k-means runs top-up may try is `TOP_UP_FACTOR * k` clusters, so the search always ends. */
export const TOP_UP_FACTOR = 2;

/** The k largest clusters, with their shares re-measured so the dropped clusters' pixels go to the nearest kept one. */
function trimToK(samples: Float64Array, clusters: Cluster[], k: number): Swatch[] {
  const kept = [...clusters].sort((a, b) => b.count - a.count).slice(0, k);
  const shares = swatchShares(
    samples,
    kept.map((c) => c.lab),
  );
  return kept
    .map((c, i) => ({ hex: rgbToHex(labToRgb(c.lab)), lab: c.lab, share: at(shares, i) }))
    .sort((a, b) => b.share - a.share || (a.hex < b.hex ? -1 : 1));
}

/** Max extra k-means runs in a row that may add no distinct swatch before the top-up gives up. */
export const TOP_UP_PATIENCE = 1;

/**
 * Whether the top-up can stop: enough swatches; k-means ran out of samples to seed more clusters; or extra clusters
 * keep splitting into near-duplicates (noise, gradients), so the image is short of clearly different colours and
 * running on to the cap would only cost time.
 */
function isTopUpDone(k: number, runK: number, clusterCount: number, mergedCount: number, stalled: number): boolean {
  return mergedCount >= k || clusterCount < runK || stalled > TOP_UP_PATIENCE;
}

/**
 * Palette from already-sampled Lab values, one k-means iteration per step (see `kmeansLabSteps`). Lazy: an invalid k
 * throws on the first `next()`. Returns null when `shouldStop` abandons the run.
 *
 * Near-duplicate clusters are merged, which can leave fewer than `k` swatches. When it does, k-means is run again with
 * one more cluster (up to `TOP_UP_FACTOR * k`) until `k` distinct swatches remain. If the image has fewer distinct
 * colours than that, the largest palette found is returned.
 */
export function* extractPaletteSteps(
  samples: Float64Array,
  options: SamplePaletteOptions,
): Generator<void, Swatch[] | null, void> {
  const { k, seed = DEFAULT_SEED, shouldStop } = options;
  assertValidK(k);
  let best: Cluster[] = [];
  let stalled = 0;
  for (let runK = k; runK <= TOP_UP_FACTOR * k; runK++) {
    const result = yield* kmeansLabSteps(samples, runK, mulberry32(seed), shouldStop ? { shouldStop } : {});
    if (result === null) return null;
    const merged = mergeClusters(clustersOf(result.centroids, result.counts), MERGE_DELTA_E);
    stalled = merged.length > best.length ? 0 : stalled + 1;
    if (merged.length > best.length) best = merged;
    if (isTopUpDone(k, runK, result.counts.length, merged.length, stalled)) break;
  }
  return best.length > k ? trimToK(samples, best, k) : toSwatches(best);
}

/** Palette from already-sampled Lab values, in one go. Returns null when `shouldStop` abandons the run. */
export function extractPaletteFromSamples(samples: Float64Array, options: SamplePaletteOptions): Swatch[] | null {
  const run = extractPaletteSteps(samples, options);
  let step = run.next();
  while (step.done !== true) step = run.next();
  return step.value;
}

export function extractPalette(pixels: PixelBuffer, options: PaletteOptions): Swatch[] {
  const swatches = extractPaletteFromSamples(sampleLabPixels(pixels), options);
  // Only null when `shouldStop` abandons the run, and this entry point never passes one.
  if (swatches === null) throw new Error('Palette extraction was abandoned');
  return swatches;
}
