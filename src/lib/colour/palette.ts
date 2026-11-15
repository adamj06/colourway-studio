import type { PixelBuffer, Swatch } from './types';

export const MERGE_DELTA_E = 5;
export const DEFAULT_SEED = 1;

export function extractPaletteFromSamples(
  _samples: Float64Array,
  _options: { k: number; seed?: number; shouldStop?: () => boolean },
): Swatch[] | null {
  throw new Error('not implemented', { cause: [_samples, _options] });
}
export function extractPalette(_pixels: PixelBuffer, _options: { k: number; seed?: number }): Swatch[] {
  throw new Error('not implemented', { cause: [_pixels, _options] });
}
