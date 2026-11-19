// Laying a repeat out on a wall. Pure functions, no DOM.

export type Rect = { x: number; y: number; w: number; h: number };
export type Repeat = 'straight' | 'half-drop';

export const MIN_REPEATS = 2;
export const MAX_REPEATS = 10;
export const DEFAULT_REPEATS = 4;

function positive(value: number, name: string): number {
  if (!(value > 0) || !Number.isFinite(value)) throw new RangeError(`${name} must be a positive number`);
  return value;
}

export type LayoutOptions = { wallW: number; wallH: number; tileW: number; tileH: number; repeat: Repeat };

/** The tiles in one column, starting at `top` (at or above the wall) and stopping once the wall's bottom is covered. */
function column(x: number, top: number, options: LayoutOptions): Rect[] {
  const tiles: Rect[] = [];
  for (let row = 0; top + row * options.tileH < options.wallH; row++) {
    tiles.push({ x, y: top + row * options.tileH, w: options.tileW, h: options.tileH });
  }
  return tiles;
}

/**
 * Every tile needed to cover the wall (0, 0, wallW, wallH), in wall pixels. A half-drop repeat drops every second
 * column by half a tile, so those columns start half a tile above the wall to cover its top edge. No tile lies
 * wholly off the wall.
 */
export function layoutTiles(options: LayoutOptions): Rect[] {
  positive(options.wallW, 'wallW');
  positive(options.wallH, 'wallH');
  positive(options.tileW, 'tileW');
  positive(options.tileH, 'tileH');
  // The type says only these two, but the value can come from the UI, so it is checked at run time too.
  const known: readonly string[] = ['straight', 'half-drop'];
  if (!known.includes(options.repeat)) throw new RangeError('repeat must be straight or half-drop');
  const columns = Math.ceil(options.wallW / options.tileW);
  const tiles: Rect[] = [];
  for (let index = 0; index < columns; index++) {
    const dropped = options.repeat === 'half-drop' && index % 2 === 1;
    tiles.push(...column(index * options.tileW, dropped ? -options.tileH / 2 : 0, options));
  }
  return tiles;
}

export type TileSizeOptions = { wallW: number; repeats: number; regionW: number; regionH: number };

/**
 * The tile's size on the wall: `repeats` across, keeping the aspect ratio of the region. Whole pixels, at least 1.
 * The width is rounded up, so `repeats` tiles always cover the wall (the last may overhang by a few pixels); rounding
 * it to nearest left a sliver of an extra column at the wall's edge (7 repeats on 1200 px gave 7 x 171 = 1197).
 */
export function tileSize(options: TileSizeOptions): { w: number; h: number } {
  const wallW = positive(options.wallW, 'wallW');
  const regionW = positive(options.regionW, 'regionW');
  const regionH = positive(options.regionH, 'regionH');
  const { repeats } = options;
  if (!Number.isInteger(repeats) || repeats < MIN_REPEATS || repeats > MAX_REPEATS) {
    throw new RangeError(`repeats must be a whole number from ${String(MIN_REPEATS)} to ${String(MAX_REPEATS)}`);
  }
  const w = Math.max(1, Math.ceil(wallW / repeats));
  return { w, h: Math.max(1, Math.round((w * regionH) / regionW)) };
}
