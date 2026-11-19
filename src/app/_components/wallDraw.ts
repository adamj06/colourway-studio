// Canvas drawing for the wall preview. Browser-only; the maths (region, tile layout) lives in src/lib/wall.
import { wallPlan } from '@/lib/wall/plan';
import type { Region } from '@/lib/wall/region';
import type { Repeat } from '@/lib/wall/tiles';
import type { ExportSource } from './exportPng';

/** The wall canvas's own pixel size. It is shown scaled to the page width, so this only sets the sharpness. */
export const WALL_W = 1200;
export const WALL_H = 640;

/** Draws the whole source onto `canvas`, sizing the canvas to it. A source that has not loaded leaves it 0 by 0. */
export function paintSource(canvas: HTMLCanvasElement, source: ExportSource): void {
  const width = source.kind === 'frame' ? source.frame.width : source.image.naturalWidth;
  const height = source.kind === 'frame' ? source.frame.height : source.image.naturalHeight;
  // Assigning a size reallocates the bitmap even when it is unchanged, and this runs for every recolour frame.
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null || width < 1 || height < 1) return;
  if (source.kind === 'frame') {
    context.putImageData(new ImageData(source.frame.data, width, height), 0, 0);
  } else {
    // The canvas is not resized every time, so clear it: transparent pixels must not show the previous picture.
    context.clearRect(0, 0, width, height);
    context.drawImage(source.image, 0, 0, width, height);
  }
}

/** Tiles the `region` of `full` (a canvas painted by `paintSource`) across the wall canvas. The plan is pure: see lib. */
export function paintWall(
  wall: HTMLCanvasElement,
  full: HTMLCanvasElement,
  region: Region,
  repeats: number,
  repeat: Repeat,
): void {
  const context = wall.getContext('2d');
  if (context === null || full.width < 1 || full.height < 1) return;
  const { source, tiles } = wallPlan({
    region,
    imageW: full.width,
    imageH: full.height,
    wallW: WALL_W,
    wallH: WALL_H,
    repeats,
    repeat,
  });
  context.clearRect(0, 0, WALL_W, WALL_H);
  for (const at of tiles) context.drawImage(full, source.x, source.y, source.w, source.h, at.x, at.y, at.w, at.h);
}
