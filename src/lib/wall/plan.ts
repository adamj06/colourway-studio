// What to draw on the wall: the crop of the image and where each tile goes. Pure, so the canvas code is a plain loop.
import { toPixels, type Pixels, type Region } from './region';
import { layoutTiles, tileSize, type Rect, type Repeat } from './tiles';

export type WallPlanOptions = {
  region: Region;
  imageW: number;
  imageH: number;
  wallW: number;
  wallH: number;
  repeats: number;
  repeat: Repeat;
};

/**
 * `source` is the region in whole pixels of the image; `tiles` are where to draw it. Tile positions are whole pixels:
 * a half-drop column sits half a tile down, and a fractional edge would draw as a seam. Each tile is rounded on its own
 * (not by accumulating a rounded drop), and the tile height is a whole number, so neighbours still meet exactly.
 */
export function wallPlan(options: WallPlanOptions): { source: Pixels; tiles: Rect[] } {
  const source = toPixels(options.region, options.imageW, options.imageH);
  const tile = tileSize({ wallW: options.wallW, repeats: options.repeats, regionW: source.w, regionH: source.h });
  const tiles = layoutTiles({
    wallW: options.wallW,
    wallH: options.wallH,
    tileW: tile.w,
    tileH: tile.h,
    repeat: options.repeat,
  }).map((at) => ({ x: Math.round(at.x), y: Math.round(at.y), w: at.w, h: at.h }));
  return { source, tiles };
}
