import type { PixelBuffer } from './types';

export const MAX_SAMPLES = 40_000;

export function sampleLabPixels(_pixels: PixelBuffer, _maxSamples?: number): Float64Array {
  throw new Error('not implemented', { cause: [_pixels, _maxSamples] });
}
