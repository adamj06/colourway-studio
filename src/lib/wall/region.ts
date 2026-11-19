// The repeat region: the part of a design image that is tiled on the wall. Pure functions, no DOM.
// A region is held as fractions of the image (0..1) so it does not depend on the size the image is shown at.

/** A rectangle as fractions of the image: `x` and `y` are the top-left corner. */
export type Region = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };
export type Pixels = { x: number; y: number; w: number; h: number };
/** A region as percentages of the image, for the number inputs. */
export type Percent = { left: number; top: number; width: number; height: number };

/** No side of a region may be smaller than this fraction of the image. */
export const MIN_SIDE = 0.05;
export const WHOLE: Region = { x: 0, y: 0, w: 1, h: 1 };

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be a finite number`);
  return value;
}

const between = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** A side and its start, made to fit: at least MIN_SIDE long, at most the whole image, and not past the far edge. */
function fitAxis(start: number, length: number): { start: number; length: number } {
  const fitted = between(length, MIN_SIDE, 1);
  return { start: between(start, 0, 1 - fitted), length: fitted };
}

/** Keeps a region inside the image and at least MIN_SIDE on each side. A region at the edge moves rather than shrinks. */
export function clampRegion(region: Region): Region {
  const x = fitAxis(finite(region.x, 'x'), finite(region.w, 'w'));
  const y = fitAxis(finite(region.y, 'y'), finite(region.h, 'h'));
  return { x: x.start, y: y.start, w: x.length, h: y.length };
}

/** The region a drag from `a` to `b` marks, in any direction. Points outside the image are pulled to its edge. */
export function regionFromPoints(a: Point, b: Point): Region {
  const [ax, ay, bx, by] = [between(a.x, 0, 1), between(a.y, 0, 1), between(b.x, 0, 1), between(b.y, 0, 1)];
  return clampRegion({ x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(ax - bx), h: Math.abs(ay - by) });
}

/** One axis in whole pixels: at least 1 pixel, and never past the size. */
function pixelSpan(start: number, length: number, size: number): { start: number; length: number } {
  const first = between(Math.round(start * size), 0, size - 1);
  const end = between(Math.round((start + length) * size), first + 1, size);
  return { start: first, length: end - first };
}

/** The region in whole pixels of an image `width` by `height`. */
export function toPixels(region: Region, width: number, height: number): Pixels {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new RangeError('width and height must be positive');
  }
  const x = pixelSpan(region.x, region.w, width);
  const y = pixelSpan(region.y, region.h, height);
  return { x: x.start, y: y.start, w: x.length, h: y.length };
}

const toTenthOfPercent = (fraction: number) => Math.round(fraction * 1000) / 10;

export function toPercent(region: Region): Percent {
  return {
    left: toTenthOfPercent(region.x),
    top: toTenthOfPercent(region.y),
    width: toTenthOfPercent(region.w),
    height: toTenthOfPercent(region.h),
  };
}

/** A region from the number inputs. Out-of-range values are clamped; a non-number is rejected. */
export function fromPercent(percent: Percent): Region {
  return clampRegion({
    x: percent.left / 100,
    y: percent.top / 100,
    w: percent.width / 100,
    h: percent.height / 100,
  });
}
