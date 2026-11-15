import { at } from './at';
import { labToRgb, rgbToHex } from './convert';
import { kmeansLabSteps, kmeansLabToEnd, type KmeansResult } from './kmeans';
import { mergeClusters, type Cluster } from './merge';
import { mulberry32 } from './prng';
import { sampleLabPixels } from './sample';
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

function paletteOf(result: KmeansResult): Swatch[] {
  return toSwatches(mergeClusters(clustersOf(result.centroids, result.counts), MERGE_DELTA_E));
}

/**
 * Palette from already-sampled Lab values, one k-means iteration per step (see `kmeansLabSteps`). Lazy: an invalid k
 * throws on the first `next()`. Returns null when `shouldStop` abandons the run.
 */
export function* extractPaletteSteps(
  samples: Float64Array,
  options: SamplePaletteOptions,
): Generator<void, Swatch[] | null, void> {
  const { k, seed = DEFAULT_SEED, shouldStop } = options;
  assertValidK(k);
  const result = yield* kmeansLabSteps(samples, k, mulberry32(seed), shouldStop ? { shouldStop } : {});
  return result === null ? null : paletteOf(result);
}

/** Palette from already-sampled Lab values, in one go. Returns null when `shouldStop` abandons the run. */
export function extractPaletteFromSamples(samples: Float64Array, options: SamplePaletteOptions): Swatch[] | null {
  const run = extractPaletteSteps(samples, options);
  let step = run.next();
  while (step.done !== true) step = run.next();
  return step.value;
}

export function extractPalette(pixels: PixelBuffer, options: PaletteOptions): Swatch[] {
  const { k, seed = DEFAULT_SEED } = options;
  assertValidK(k);
  return paletteOf(kmeansLabToEnd(sampleLabPixels(pixels), k, mulberry32(seed)));
}
