// Recolouring: every pixel moves by a weighted blend of the Lab shifts of the palette swatches (soft blend), so the
// lightness detail of the design is kept and edges between two colours stay smooth. Pure functions, no DOM.
import { at } from './at';
import { labToRgb, rgbToLab } from './convert';
import type { Lab } from './types';

/** Lab values of every pixel as a flat [L, a, b, ...] array. Alpha is ignored. */
export function labPixels(rgba: Uint8ClampedArray): Float64Array {
  const count = Math.floor(rgba.length / 4);
  const out = new Float64Array(count * 3);
  for (let p = 0; p < count; p++) {
    out.set(rgbToLab([at(rgba, p * 4), at(rgba, p * 4 + 1), at(rgba, p * 4 + 2)]), p * 3);
  }
  return out;
}

/** Inverse distance to the fourth power, normalised. A pixel sitting on a swatch (distance 0) belongs to it alone. */
function pixelWeights(l: number, a: number, b: number, sources: readonly Lab[]): number[] {
  const raw = sources.map(([sl, sa, sb]) => (l - sl) ** 2 + (a - sa) ** 2 + (b - sb) ** 2);
  const onSwatch = raw.filter((squared) => squared === 0).length;
  if (onSwatch > 0) return raw.map((squared) => (squared === 0 ? 1 / onSwatch : 0));
  const inverse = raw.map((squared) => 1 / (squared * squared));
  const total = inverse.reduce((sum, value) => sum + value, 0);
  return inverse.map((value) => value / total);
}

/** One weight per pixel per swatch (pixel-major), each pixel's weights summing to 1. Depends only on the source palette. */
export function blendWeights(labs: Float64Array, sources: readonly Lab[]): Float64Array {
  const count = Math.floor(labs.length / 3);
  const out = new Float64Array(count * sources.length);
  for (let p = 0; p < count; p++) {
    out.set(pixelWeights(at(labs, p * 3), at(labs, p * 3 + 1), at(labs, p * 3 + 2), sources), p * sources.length);
  }
  return out;
}

/** Moves every pixel by its weighted blend of `shifts` (target Lab minus source Lab). Alpha comes from `rgba`. */
export function applyShifts(
  rgba: Uint8ClampedArray,
  labs: Float64Array,
  weights: Float64Array,
  shifts: readonly Lab[],
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(rgba.length);
  const swatches = shifts.length;
  const count = Math.floor(rgba.length / 4);
  for (let p = 0; p < count; p++) {
    let dl = 0;
    let da = 0;
    let db = 0;
    for (let s = 0; s < swatches; s++) {
      const weight = at(weights, p * swatches + s);
      const [sl, sa, sb] = shifts[s] ?? [0, 0, 0];
      dl += weight * sl;
      da += weight * sa;
      db += weight * sb;
    }
    out.set(labToRgb([at(labs, p * 3) + dl, at(labs, p * 3 + 1) + da, at(labs, p * 3 + 2) + db]), p * 4);
    out[p * 4 + 3] = at(rgba, p * 4 + 3);
  }
  return out;
}

export function shiftsOf(sources: readonly Lab[], targets: readonly Lab[]): Lab[] {
  return sources.map(([l, a, b], i) => {
    const [tl, ta, tb] = targets[i] ?? [l, a, b];
    return [tl - l, ta - a, tb - b];
  });
}

/** Recolours RGBA pixels so that colours near `sources[i]` move towards `targets[i]`. */
export function recolour(
  rgba: Uint8ClampedArray,
  sources: readonly Lab[],
  targets: readonly Lab[],
): Uint8ClampedArray<ArrayBuffer> {
  if (rgba.length % 4 !== 0) throw new RangeError('Pixel data length must be a multiple of 4 (RGBA).');
  if (sources.length === 0) throw new RangeError('At least one swatch is needed.');
  if (sources.length !== targets.length) throw new RangeError('Every source swatch needs exactly one target.');
  const labs = labPixels(rgba);
  return applyShifts(rgba, labs, blendWeights(labs, sources), shiftsOf(sources, targets));
}
