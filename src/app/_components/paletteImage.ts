// Browser-side helpers that turn the already loaded design image into something the palette worker can read.
// No second download: the <img> is drawn (or bitmap-copied) at a downscaled size.
import { fitWithin } from '@/lib/image/fit';

/** Longest side analysed. 600 px is plenty for a palette and keeps the worker fast. */
export const ANALYSIS_MAX_SIDE = 600;

export type PixelSnapshot = { width: number; height: number; data: Uint8ClampedArray };
export type Snapshot = { kind: 'bitmap'; bitmap: ImageBitmap } | { kind: 'pixels'; image: PixelSnapshot };

function canUseBitmaps(): boolean {
  return typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined';
}

function drawToPixels(img: HTMLImageElement, width: number, height: number): PixelSnapshot {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) throw new Error('No 2d canvas context.');
  context.drawImage(img, 0, 0, width, height);
  // Throws a SecurityError if the canvas is tainted (an image loaded without CORS): the caller shows the error state.
  return { width, height, data: context.getImageData(0, 0, width, height).data };
}

/**
 * Preferred: a downscaled ImageBitmap, transferred to the worker (no pixels copied on the main thread).
 * Fallback (no createImageBitmap or OffscreenCanvas): draw to a small canvas and send the RGBA pixels.
 */
export async function snapshotImage(img: HTMLImageElement): Promise<Snapshot> {
  const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, ANALYSIS_MAX_SIDE);
  if (canUseBitmaps()) {
    try {
      const bitmap = await createImageBitmap(img, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
      return { kind: 'bitmap', bitmap };
    } catch {
      // Some browsers reject resize options or the source: fall back to the canvas path below.
    }
  }
  return { kind: 'pixels', image: drawToPixels(img, width, height) };
}

/** Sends a snapshot to the worker, transferring (not copying) the big buffer. */
export function postSnapshot(worker: Worker, snapshot: Snapshot, id: number, k: number): void {
  if (snapshot.kind === 'bitmap') {
    worker.postMessage({ type: 'analyse-bitmap', id, k, bitmap: snapshot.bitmap }, [snapshot.bitmap]);
    return;
  }
  worker.postMessage({ type: 'analyse', id, k, image: snapshot.image }, [snapshot.image.data.buffer]);
}
