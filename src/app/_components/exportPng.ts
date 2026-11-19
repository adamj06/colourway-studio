// Export the design as a PNG. Loaded on demand (dynamic import from the Export button), so none of it is in the
// first-load JS. Browser-only: it draws to a canvas, then the pure lib adds the credit text chunks.
import { fitWithin } from '@/lib/image/fit';
import { exportTextEntries } from '@/lib/png/attribution';
import { insertTextChunks } from '@/lib/png/text-chunk';
import type { Frame } from './recolourClient';

/** The longest side of an exported file: what the viewer shows (the design image is requested at 1600 px). */
export const EXPORT_MAX_SIDE = 1600;
const REVOKE_AFTER_MS = 60_000;

/** What to export: a settled recoloured frame, or the untouched design image. */
export type ExportSource = { kind: 'frame'; frame: Frame } | { kind: 'image'; image: HTMLImageElement };

/** A canvas of this size and its 2d context. A missing context is an error: an empty canvas would export blank. */
function canvasOf(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('No 2d canvas context.');
  return { canvas, context };
}

function drawn(source: ExportSource): HTMLCanvasElement {
  if (source.kind === 'frame') {
    const { frame } = source;
    const { canvas, context } = canvasOf(frame.width, frame.height);
    context.putImageData(new ImageData(frame.data, frame.width, frame.height), 0, 0);
    return canvas;
  }
  const { width, height } = fitWithin(source.image.naturalWidth, source.image.naturalHeight, EXPORT_MAX_SIDE);
  const { canvas, context } = canvasOf(width, height);
  context.drawImage(source.image, 0, 0, width, height);
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('The canvas could not be encoded as a PNG.'));
      else resolve(blob);
    }, 'image/png');
  });
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoke well after the click: some browsers read the blob after it, and revoking at once can cancel the save.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, REVOKE_AFTER_MS);
}

/** Saves `<systemNumber>-colourway.png`. Rejects if the image cannot be read (a tainted canvas) or encoded. */
export async function exportPng(source: ExportSource, systemNumber: string): Promise<void> {
  const blob = await toBlob(drawn(source));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const credited = insertTextChunks(bytes, exportTextEntries(systemNumber));
  download(new Blob([credited], { type: 'image/png' }), `${systemNumber}-colourway.png`);
}
