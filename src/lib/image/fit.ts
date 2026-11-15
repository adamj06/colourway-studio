export type Size = { width: number; height: number };

/**
 * Scales a size down (never up) so its longest side is at most `maxSide`, keeping the aspect ratio.
 * Both sides are at least 1 pixel.
 */
export function fitWithin(width: number, height: number, maxSide: number): Size {
  if (!(width > 0) || !(height > 0) || !(maxSide >= 1)) {
    throw new RangeError('width, height and maxSide must be positive');
  }
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
