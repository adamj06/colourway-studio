// Canvas drawing for the wall preview. Browser-only; the maths (region, tile layout) lives in src/lib/wall.
import { toPixels, type Region } from '@/lib/wall/region';
import { layoutTiles, tileSize, type Repeat } from '@/lib/wall/tiles';
import type { ExportSource } from './exportPng';

/** The wall canvas's own pixel size. It is shown scaled to the page width, so this only sets the sharpness. */
export const WALL_W = 1200;
export const WALL_H = 640;

/** Draws the whole source onto `canvas`, sizing the canvas to it. A source that has not loaded leaves it 0 by 0. */
export function paintSource(canvas: HTMLCanvasElement, source: ExportSource): void {
  const width = source.kind === 'frame' ? source.frame.width : source.image.naturalWidth;
  const height = source.kind === 'frame' ? source.frame.height : source.image.naturalHeight;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null || width < 1 || height < 1) return;
  if (source.kind === 'frame') {
    context.putImageData(new ImageData(source.frame.data, width, height), 0, 0);
  } else {
    context.drawImage(source.image, 0, 0, width, height);
  }
}

/** Tiles the `region` of `full` (a canvas painted by `paintSource`) across the wall canvas. */
export function paintWall(
  wall: HTMLCanvasElement,
  full: HTMLCanvasElement,
  region: Region,
  repeats: number,
  repeat: Repeat,
): void {
  const context = wall.getContext('2d');
  if (context === null || full.width < 1 || full.height < 1) return;
  const crop = toPixels(region, full.width, full.height);
  const tile = tileSize({ wallW: WALL_W, repeats, regionW: crop.w, regionH: crop.h });
  context.clearRect(0, 0, WALL_W, WALL_H);
  for (const at of layoutTiles({ wallW: WALL_W, wallH: WALL_H, tileW: tile.w, tileH: tile.h, repeat })) {
    // Whole-pixel positions: a half-drop column sits half a tile down, and a fractional edge would show as a seam.
    context.drawImage(full, crop.x, crop.y, crop.w, crop.h, Math.round(at.x), Math.round(at.y), at.w, at.h);
  }
}
