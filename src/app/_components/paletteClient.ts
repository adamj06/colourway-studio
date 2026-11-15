import type { Swatch } from '@/lib/colour/types';
import { responseSchema } from '@/workers/palette-protocol';
import { postSnapshot, snapshotImage } from './paletteImage';

/** What the UI wants analysed. `tag` identifies the state the answer belongs to (it comes back with the result). */
export type PaletteRequest = { k: number; tag: string };

export type PaletteClient = {
  /** Ask for a palette with a new k. A request still running in the worker is superseded and never shown. */
  request: (next: PaletteRequest) => void;
  dispose: () => void;
};

/**
 * Owns one palette worker for one loaded image. The worker is created here, lazily, so the colour code is only
 * downloaded on the design page. `onResult` gets swatches, or null when extraction failed.
 */
export function createPaletteClient(
  image: HTMLImageElement,
  first: PaletteRequest,
  onResult: (tag: string, swatches: Swatch[] | null) => void,
): PaletteClient {
  const worker = new Worker(new URL('../../workers/palette.worker.ts', import.meta.url), { type: 'module' });
  const tags = new Map<number, string>();
  let latest = first;
  let analysed = false;
  let stopped = false;
  let nextId = 0;
  let newestId = -1;

  const startRequest = (request: PaletteRequest): number => {
    const id = nextId++;
    newestId = id;
    tags.set(id, request.tag);
    return id;
  };
  const fail = () => {
    if (!stopped) onResult(latest.tag, null);
  };

  worker.onmessage = (event: MessageEvent<unknown>) => {
    const parsed = responseSchema.safeParse(event.data);
    if (!parsed.success) {
      fail();
      return;
    }
    const { data } = parsed;
    // Late answers to superseded requests are ignored: only the newest request id is ever shown.
    const tag = tags.get(data.id ?? -1);
    if (stopped || data.id !== newestId || tag === undefined) return;
    onResult(tag, data.type === 'palette' ? data.swatches : null);
  };
  worker.onerror = fail;

  snapshotImage(image).then((snapshot) => {
    if (stopped) return;
    postSnapshot(worker, snapshot, startRequest(latest), latest.k);
    analysed = true;
  }, fail);

  return {
    request(next) {
      latest = next;
      if (analysed) worker.postMessage({ type: 'set-k', id: startRequest(next), k: next.k });
    },
    dispose() {
      stopped = true;
      worker.terminate();
    },
  };
}
