// Recolouring: every pixel moves by a weighted blend of the Lab shifts of the palette swatches (soft blend), so the
// lightness detail of the design is kept and edges between two colours stay smooth. Pure functions, no DOM.
import { at } from './at';
import { labToRgb, labToXyz, linearToSrgb, rgbToLab, xyzToLinearRgb } from './convert';
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

type Weights = Float32Array | Float64Array;

/** Writes each swatch's squared Lab distance from (l, a, b) into out[offset...] and returns how many are exactly zero. */
function writeSquaredDistances(l: number, a: number, b: number, sources: readonly Lab[], out: Weights, offset: number) {
  let exact = 0;
  sources.forEach(([sl, sa, sb], s) => {
    const squared = (l - sl) ** 2 + (a - sa) ** 2 + (b - sb) ** 2;
    if (squared === 0) exact++;
    out[offset + s] = squared;
  });
  return exact;
}

/**
 * Writes the blend weight of each swatch for a pixel colour into out[offset...]: inverse distance to the fourth power,
 * normalised to sum to 1. A pixel sitting on a swatch (distance 0) belongs to it alone, shared evenly if several do.
 */
function writeWeights(l: number, a: number, b: number, sources: readonly Lab[], out: Weights, offset: number): void {
  const count = sources.length;
  const exact = writeSquaredDistances(l, a, b, sources, out, offset);
  let total = 0;
  for (let s = offset; s < offset + count; s++) {
    const squared = at(out, s);
    const value = exact > 0 ? (squared === 0 ? 1 / exact : 0) : 1 / (squared * squared);
    out[s] = value;
    total += value;
  }
  if (exact > 0) return;
  for (let s = offset; s < offset + count; s++) out[s] = at(out, s) / total;
}

/** One weight per pixel per swatch (pixel-major), each pixel's weights summing to 1. Depends only on the source palette. */
export function blendWeights(labs: Float64Array, sources: readonly Lab[]): Float64Array {
  const count = Math.floor(labs.length / 3);
  const out = new Float64Array(count * sources.length);
  for (let p = 0; p < count; p++) {
    writeWeights(at(labs, p * 3), at(labs, p * 3 + 1), at(labs, p * 3 + 2), sources, out, p * sources.length);
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

const DEFAULT_LUT_SIZE = 65;

function checkSize(size: number): void {
  if (!Number.isInteger(size) || size < 2) throw new RangeError('LUT size must be an integer of at least 2.');
}

/** Unrounded sRGB (0..255, clamped to the gamut) of a Lab colour, so the table keeps sub-byte precision. */
function labToSrgb255(lab: Lab): [number, number, number] {
  const [r, g, b] = xyzToLinearRgb(labToXyz(lab));
  const channel = (linear: number) => linearToSrgb(Math.min(1, Math.max(0, linear))) * 255;
  return [channel(r), channel(g), channel(b)];
}

/** The byte value of grid node `i` along an axis: evenly spaced, rounded to a real colour. */
function nodeByte(i: number, size: number): number {
  return Math.round((i * 255) / (size - 1));
}

/** Fills the Lab colour and blend weights of every grid node (r-major). These depend only on the source palette. */
function fillNodes(size: number, sources: readonly Lab[], labs: Float64Array, weights: Float32Array): void {
  const bytes = Array.from({ length: size }, (_, i) => nodeByte(i, size));
  for (let n = 0; n < size ** 3; n++) {
    const r = Math.floor(n / (size * size));
    const g = Math.floor(n / size) % size;
    const [l, a, b] = rgbToLab([at(bytes, r), at(bytes, g), at(bytes, n % size)]);
    labs.set([l, a, b], n * 3);
    writeWeights(l, a, b, sources, weights, n * sources.length);
  }
}

/** The table for one set of targets: every node moved by its blend of the swatch shifts, as unrounded sRGB. */
function shiftTable(labs: Float64Array, weights: Float32Array, shifts: readonly Lab[]): Float32Array {
  const swatches = shifts.length;
  const flat = Float64Array.from(shifts.flat());
  const nodes = labs.length / 3;
  const out = new Float32Array(nodes * 3);
  for (let n = 0; n < nodes; n++) {
    let dl = 0;
    let da = 0;
    let db = 0;
    for (let s = 0; s < swatches; s++) {
      const weight = weights[n * swatches + s] as number;
      dl += weight * (flat[s * 3] as number);
      da += weight * (flat[s * 3 + 1] as number);
      db += weight * (flat[s * 3 + 2] as number);
    }
    const [r, g, b] = labToSrgb255([
      (labs[n * 3] as number) + dl,
      (labs[n * 3 + 1] as number) + da,
      (labs[n * 3 + 2] as number) + db,
    ]);
    out[n * 3] = r;
    out[n * 3 + 1] = g;
    out[n * 3 + 2] = b;
  }
  return out;
}

export type RecolourLutBuilder = (targets: readonly Lab[]) => Float32Array;

/**
 * Prepares a table builder for one palette. The Lab colour and blend weights of every grid node depend only on the
 * source palette, so they are computed here once; each call with new targets then only moves the nodes, which is
 * what makes a live colour picker affordable.
 */
export function createLutBuilder(sources: readonly Lab[], size: number = DEFAULT_LUT_SIZE): RecolourLutBuilder {
  if (sources.length === 0) throw new RangeError('At least one swatch is needed.');
  checkSize(size);
  const labs = new Float64Array(size ** 3 * 3);
  const weights = new Float32Array(size ** 3 * sources.length);
  fillNodes(size, sources, labs, weights);
  return (targets) => {
    if (sources.length !== targets.length) throw new RangeError('Every source swatch needs exactly one target.');
    return shiftTable(labs, weights, shiftsOf(sources, targets));
  };
}

/**
 * A size x size x size table over sRGB holding the direct recolour of each grid node (r-major, three values per
 * node, unrounded 0..255). A pixel's new colour depends only on its own colour, so the table is built once per
 * palette edit and every pixel is then a cheap lookup: see `applyLut`.
 */
export function buildRecolourLut(
  sources: readonly Lab[],
  targets: readonly Lab[],
  size: number = DEFAULT_LUT_SIZE,
): Float32Array {
  return createLutBuilder(sources, size)(targets);
}

/** Grid cell and fraction of a byte value along one axis, measured between the actual (rounded) node positions. */
function axis(value: number, size: number): [number, number] {
  let cell = Math.min(Math.floor((value * (size - 1)) / 255), size - 2);
  while (cell > 0 && nodeByte(cell, size) > value) cell--;
  while (cell < size - 2 && nodeByte(cell + 1, size) <= value) cell++;
  const low = nodeByte(cell, size);
  return [cell, (value - low) / (nodeByte(cell + 1, size) - low)];
}

type AxisTable = { cell: Int32Array; frac: Float64Array };
const axisTables = new Map<number, AxisTable>();

/** `axis` for every byte value, computed once per table size. */
function axisTable(size: number): AxisTable {
  const cached = axisTables.get(size);
  if (cached) return cached;
  const table = { cell: new Int32Array(256), frac: new Float64Array(256) };
  for (let value = 0; value < 256; value++) {
    const [cell, frac] = axis(value, size);
    table.cell[value] = cell;
    table.frac[value] = frac;
  }
  axisTables.set(size, table);
  return table;
}

/** Table offsets (in values) of the eight corners of a cell relative to its lowest corner (bit 0 = r, 1 = g, 2 = b). */
function cornerOffsets(size: number): Int32Array {
  const [r, g, b] = [size * size * 3, size * 3, 3];
  return Int32Array.of(0, r, g, r + g, b, r + b, g + b, r + g + b);
}

// The pixel loop below indexes typed arrays directly rather than through `at`: `at` is shared by every typed array
// kind in this file, which makes its element access megamorphic and several times slower in a loop this hot.
function blendCorners(lut: Float32Array, base: number, offsets: Int32Array, w: Float64Array, channel: number): number {
  let sum = 0;
  for (let k = 0; k < 8; k++) sum += (w[k] as number) * (lut[base + (offsets[k] as number) + channel] as number);
  return sum;
}

/** Weights of the eight corners of a cell, in the order of `cornerOffsets`. */
function cornerWeights(fr: number, fg: number, fb: number, w: Float64Array): void {
  const r0 = 1 - fr;
  const g0 = 1 - fg;
  const b0 = 1 - fb;
  w[0] = r0 * g0 * b0;
  w[1] = fr * g0 * b0;
  w[2] = r0 * fg * b0;
  w[3] = fr * fg * b0;
  w[4] = r0 * g0 * fb;
  w[5] = fr * g0 * fb;
  w[6] = r0 * fg * fb;
  w[7] = fr * fg * fb;
}

/** Recolours RGBA pixels by trilinear lookup in a table from `buildRecolourLut`. Alpha is unchanged. */
export function applyLut(
  rgba: Uint8ClampedArray,
  lut: Float32Array,
  size: number = DEFAULT_LUT_SIZE,
): Uint8ClampedArray<ArrayBuffer> {
  if (rgba.length % 4 !== 0) throw new RangeError('Pixel data length must be a multiple of 4 (RGBA).');
  checkSize(size);
  if (lut.length !== size ** 3 * 3) throw new RangeError('LUT length does not match its size.');
  const out = new Uint8ClampedArray(rgba.length);
  const { cell, frac } = axisTable(size);
  const offsets = cornerOffsets(size);
  const w = new Float64Array(8);
  for (let p = 0; p < rgba.length; p += 4) {
    const r = rgba[p] as number;
    const g = rgba[p + 1] as number;
    const b = rgba[p + 2] as number;
    const base = ((cell[r] as number) * size * size + (cell[g] as number) * size + (cell[b] as number)) * 3;
    cornerWeights(frac[r] as number, frac[g] as number, frac[b] as number, w);
    out[p] = blendCorners(lut, base, offsets, w, 0);
    out[p + 1] = blendCorners(lut, base, offsets, w, 1);
    out[p + 2] = blendCorners(lut, base, offsets, w, 2);
    out[p + 3] = rgba[p + 3] as number;
  }
  return out;
}
