import type { Swatch } from '@/lib/colour/types';
import { responseSchema } from '@/workers/palette-protocol';
import { postSnapshot, snapshotImage, type Snapshot } from './paletteImage';

/** What the UI wants analysed. `tag` identifies the state the answer belongs to (it comes back with the result). */
export type PaletteRequest = { k: number; tag: string };

export type PaletteClient = {
  /** Ask for a palette with a new k. A request still running in the worker is superseded and never shown. */
  request: (next: PaletteRequest) => void;
  dispose: () => void;
};

type Answer = { kind: 'fail' } | { kind: 'answer'; id: number; swatches: Swatch[] | null };

/** A response that does not match the protocol, or an error with no request id, counts as a failure. */
function interpret(data: unknown): Answer {
  const parsed = responseSchema.safeParse(data);
  if (!parsed.success || parsed.data.id === null) return { kind: 'fail' };
  const { id } = parsed.data;
  return { kind: 'answer', id, swatches: parsed.data.type === 'palette' ? parsed.data.swatches : null };
}

function releaseSnapshot(snapshot: Snapshot): void {
  if (snapshot.kind === 'bitmap') snapshot.bitmap.close();
}

/** Posts the snapshot; a bitmap that could not be transferred is still ours to release. */
function postOrRelease(worker: Worker, snapshot: Snapshot, id: number, k: number): void {
  try {
    postSnapshot(worker, snapshot, id, k);
  } catch (error) {
    releaseSnapshot(snapshot);
    throw error;
  }
}

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
  // Once the image or worker has failed, later k changes answer with the failure at once instead of waiting forever.
  let broken = false;
  let nextId = 0;
  let newestId = -1;

  const startRequest = (request: PaletteRequest): number => {
    newestId = nextId++;
    tags.set(newestId, request.tag);
    return newestId;
  };
  const fail = () => {
    broken = true;
    worker.terminate();
    if (!stopped) onResult(latest.tag, null);
  };

  worker.onmessage = (event: MessageEvent<unknown>) => {
    const answer = interpret(event.data);
    if (answer.kind === 'fail') {
      fail();
      return;
    }
    // Late answers to superseded requests are ignored: only the newest request id is ever shown.
    const tag = tags.get(answer.id);
    if (stopped || answer.id !== newestId || tag === undefined) return;
    onResult(tag, answer.swatches);
  };
  worker.onerror = fail;
  worker.onmessageerror = fail;

  snapshotImage(image)
    .then((snapshot) => {
      if (stopped) {
        releaseSnapshot(snapshot);
        return;
      }
      postOrRelease(worker, snapshot, startRequest(latest), latest.k);
      analysed = true;
    })
    .catch(fail);

  return {
    request(next) {
      latest = next;
      if (broken) {
        if (!stopped) onResult(next.tag, null);
        return;
      }
      if (analysed) worker.postMessage({ type: 'set-k', id: startRequest(next), k: next.k });
    },
    dispose() {
      stopped = true;
      worker.terminate();
    },
  };
}
