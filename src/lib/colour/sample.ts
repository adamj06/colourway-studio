import { rgbToLab } from './convert';
import type { PixelBuffer } from './types';

export const MAX_SAMPLES = 40_000;
/** Pixels below this alpha are treated as transparent and ignored. */
const MIN_ALPHA = 128;

function isOpaque(data: Uint8ClampedArray, pixel: number): boolean {
  return (data[pixel * 4 + 3] ?? 0) >= MIN_ALPHA;
}

/**
 * Lab values of the opaque pixels as a flat [L, a, b, ...] array, at most `maxSamples` of them.
 * Every `stride`-th opaque pixel is taken (deterministic), so transparent pixels never spend the budget.
 */
export function sampleLabPixels(pixels: PixelBuffer, maxSamples: number = MAX_SAMPLES): Float64Array {
  const { data } = pixels;
  const total = Math.floor(data.length / 4);
  let opaque = 0;
  for (let p = 0; p < total; p++) if (isOpaque(data, p)) opaque++;

  const stride = Math.max(1, Math.ceil(opaque / maxSamples));
  const out = new Float64Array(Math.ceil(opaque / stride) * 3);
  let seen = 0;
  let written = 0;
  for (let p = 0; p < total; p++) {
    if (!isOpaque(data, p)) continue;
    if (seen % stride === 0) {
      const lab = rgbToLab([data[p * 4] ?? 0, data[p * 4 + 1] ?? 0, data[p * 4 + 2] ?? 0]);
      out.set(lab, written * 3);
      written++;
    }
    seen++;
  }
  return out.subarray(0, written * 3);
}
