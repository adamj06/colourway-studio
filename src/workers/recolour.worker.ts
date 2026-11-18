// Web Worker entry for recolouring. A thin wrapper: all logic is in recolour-handler.ts (unit tested in node).
// Loaded lazily with `new Worker(new URL(...))` from the design page, and only once a colour has been changed.
//
// 'prepare-bitmap' carries an ImageBitmap transferred from the page; it is read through an OffscreenCanvas and then
// handled exactly like pixels. Everything else goes straight to the validated handler.
import { z } from 'zod';
import { MAX_K } from './palette-protocol';
import { createRecolourHandler } from './recolour-handler';
import { MAX_RECOLOUR_SIDE, MIN_SWATCHES, type RecolourResponse } from './recolour-protocol';

type WorkerScope = {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

const scope = self as unknown as WorkerScope;
const handler = createRecolourHandler();

const lab = z.tuple([z.number(), z.number(), z.number()]);
const bitmapRequest = z.object({
  type: z.literal('prepare-bitmap'),
  id: z.number().int().nonnegative(),
  sources: z.array(lab).min(MIN_SWATCHES).max(MAX_K),
  bitmap: z
    .instanceof(ImageBitmap)
    .refine((b) => b.width >= 1 && b.height >= 1 && b.width <= MAX_RECOLOUR_SIDE && b.height <= MAX_RECOLOUR_SIDE, {
      message: 'bitmap size is outside the accepted range',
    }),
});

/** A rejected request still owns a transferred bitmap: release it now instead of waiting for garbage collection. */
function releaseBitmap(data: unknown): void {
  if (typeof data === 'object' && data !== null && 'bitmap' in data && data.bitmap instanceof ImageBitmap) {
    data.bitmap.close();
  }
}

function post(response: RecolourResponse): void {
  // The pixel buffer is handed over, not copied.
  scope.postMessage(response, response.type === 'image' ? [response.data.buffer] : []);
}

function readPixels(bitmap: ImageBitmap): { width: number; height: number; data: Uint8ClampedArray } {
  const { width, height } = bitmap;
  const context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
  if (context === null) throw new Error('No 2d context in the worker.');
  context.drawImage(bitmap, 0, 0);
  return { width, height, data: context.getImageData(0, 0, width, height).data };
}

async function handleBitmap(message: z.infer<typeof bitmapRequest>): Promise<void> {
  try {
    const image = readPixels(message.bitmap);
    await handler.handle({ type: 'prepare', id: message.id, image, sources: message.sources }, post);
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
  releaseBitmap(event.data);
  void handler.handle(event.data, post);
};
