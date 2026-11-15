// Web Worker entry. A thin wrapper: all logic is in palette-handler.ts (unit tested in node).
// Loaded lazily with `new Worker(new URL(...))` from the design page, so none of this is in first-load JS.
//
// Two ways in:
//  - 'analyse-bitmap': an ImageBitmap transferred from the page (already decoded, downscaled by createImageBitmap).
//    It is read through an OffscreenCanvas here, then handled exactly like pixels.
//  - anything else (the fallback path sends RGBA pixels, and 'set-k') goes straight to the validated handler.
import { z } from 'zod';
import { createPaletteHandler } from './palette-handler';
import { MAX_IMAGE_SIDE, MAX_K, MIN_K, type PaletteResponse } from './palette-protocol';

type WorkerScope = {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
};

const scope = self as unknown as WorkerScope;
const handler = createPaletteHandler();

const bitmapRequest = z.object({
  type: z.literal('analyse-bitmap'),
  id: z.number().int().nonnegative(),
  k: z.number().int().min(MIN_K).max(MAX_K),
  bitmap: z.instanceof(ImageBitmap),
});

function post(response: PaletteResponse): void {
  scope.postMessage(response);
}

function readPixels(bitmap: ImageBitmap): { width: number; height: number; data: Uint8ClampedArray } {
  const { width, height } = bitmap;
  if (width < 1 || height < 1 || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) {
    throw new RangeError('Image size is outside the accepted range.');
  }
  const context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
  if (context === null) throw new Error('No 2d context in the worker.');
  context.drawImage(bitmap, 0, 0);
  return { width, height, data: context.getImageData(0, 0, width, height).data };
}

async function handleBitmap(message: z.infer<typeof bitmapRequest>): Promise<void> {
  try {
    const image = readPixels(message.bitmap);
    await handler.handle({ type: 'analyse', id: message.id, k: message.k, image }, post);
  } catch {
    post({ type: 'error', id: message.id, message: 'Could not read the image.' });
  } finally {
    message.bitmap.close();
  }
}

scope.onmessage = (event) => {
  const bitmap = bitmapRequest.safeParse(event.data);
  if (bitmap.success) {
    void handleBitmap(bitmap.data);
    return;
  }
  void handler.handle(event.data, post);
};
