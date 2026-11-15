import { labToRgb, rgbToHex } from './convert';
import { kmeansLab } from './kmeans';
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
    lab: [centroids[c * 3] ?? 0, centroids[c * 3 + 1] ?? 0, centroids[c * 3 + 2] ?? 0],
    count,
  }));
}

function toSwatches(clusters: Cluster[]): Swatch[] {
  const total = clusters.reduce((sum, c) => sum + c.count, 0);
  return clusters
    .map((c) => ({ hex: rgbToHex(labToRgb(c.lab)), lab: c.lab, share: c.count / total }))
    .sort((a, b) => b.share - a.share || (a.hex < b.hex ? -1 : a.hex > b.hex ? 1 : 0));
}

/** Palette from already-sampled Lab values. Returns null when `shouldStop` abandons the run. */
export function extractPaletteFromSamples(samples: Float64Array, options: SamplePaletteOptions): Swatch[] | null {
  const { k, seed = DEFAULT_SEED, shouldStop } = options;
  assertValidK(k);
  const result = kmeansLab(samples, k, mulberry32(seed), shouldStop ? { shouldStop } : {});
  if (result === null) return null;
  return toSwatches(mergeClusters(clustersOf(result.centroids, result.counts), MERGE_DELTA_E));
}

export function extractPalette(pixels: PixelBuffer, options: PaletteOptions): Swatch[] {
  assertValidK(options.k);
  return extractPaletteFromSamples(sampleLabPixels(pixels), options) ?? [];
}
