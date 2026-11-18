import { hexToRgb, rgbToLab } from '@/lib/colour/convert';
import type { Lab } from '@/lib/colour/types';
import { responseSchema } from '@/workers/recolour-protocol';
import { snapshotImage, type Snapshot } from './paletteImage';

/** Longest side recoloured. The design view's image is requested at 1600 px, so this is its own size. */
export const RECOLOUR_MAX_SIDE = 1600;

export type Frame = { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> };

/** What the UI wants drawn. `tag` identifies the state the answer belongs to (it comes back with the result). */
export type RecolourRequest = { targets: Lab[]; tag: string };

export type RecolourClient = {
  /** Ask for the design in new colours. A request still running in the worker is superseded and never shown. */
  request: (next: RecolourRequest) => void;
  dispose: () => void;
};

export const labOfHex = (hex: string): Lab => rgbToLab(hexToRgb(hex));

type Answer = { kind: 'fail' } | { kind: 'answer'; id: number; frame: Frame | null };

function interpret(data: unknown): Answer {
  const parsed = responseSchema.safeParse(data);
  if (!parsed.success || parsed.data.id === null) return { kind: 'fail' };
  const { id } = parsed.data;
  if (parsed.data.type === 'error') return { kind: 'answer', id, frame: null };
  const { width, height } = parsed.data;
  // Same buffer, narrowed: a response from our own worker never carries a SharedArrayBuffer.
  return { kind: 'answer', id, frame: { width, height, data: parsed.data.data } };
}

function postPrepare(worker: Worker, snapshot: Snapshot, sources: Lab[], id: number): void {
  if (snapshot.kind === 'bitmap') {
    worker.postMessage({ type: 'prepare-bitmap', id, sources, bitmap: snapshot.bitmap }, [snapshot.bitmap]);
    return;
  }
  worker.postMessage({ type: 'prepare', id, image: snapshot.image, sources }, [snapshot.image.data.buffer]);
}

function release(snapshot: Snapshot): void {
  if (snapshot.kind === 'bitmap') snapshot.bitmap.close();
}

const PREPARE_ID = 0;

/** Request ids and the tag each one was asked for. Id 0 is the prepare message; recolour requests follow. */
function createIds() {
  const tags = new Map<number, string>();
  let next = 1;
  let newest = -1;
  return {
    start(tag: string): number {
      newest = next++;
      tags.set(newest, tag);
      return newest;
    },
    tagIfNewest: (id: number): string | undefined => (id === newest ? tags.get(id) : undefined),
  };
}

/** Snapshots the image and hands it to the worker. False when the client was disposed first (nothing was sent). */
async function prepareWorker(
  worker: Worker,
  image: HTMLImageElement,
  sources: Lab[],
  isStopped: () => boolean,
): Promise<boolean> {
  const snapshot = await snapshotImage(image, RECOLOUR_MAX_SIDE);
  if (isStopped()) {
    release(snapshot);
    return false;
  }
  try {
    postPrepare(worker, snapshot, sources, PREPARE_ID);
  } catch (error) {
    release(snapshot);
    throw error;
  }
  return true;
}

/**
 * Owns one recolour worker for one loaded image and one source palette. The worker is created here, lazily, so
 * none of this is downloaded until a colour is first changed. `onResult` gets a frame, or null when it failed.
 */
export function createRecolourClient(
  image: HTMLImageElement,
  sources: Lab[],
  first: RecolourRequest,
  onResult: (tag: string, frame: Frame | null) => void,
): RecolourClient {
  const worker = new Worker(new URL('../../workers/recolour.worker.ts', import.meta.url), { type: 'module' });
  const ids = createIds();
  let latest = first;
  let prepared = false;
  let stopped = false;
  let broken = false;

  const send = (request: RecolourRequest) => {
    worker.postMessage({ type: 'recolour', id: ids.start(request.tag), targets: request.targets });
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
    // Late answers to superseded requests are ignored: only the newest request id is ever drawn.
    const tag = ids.tagIfNewest(answer.id);
    if (stopped || tag === undefined) return;
    onResult(tag, answer.frame);
  };
  worker.onerror = fail;
  worker.onmessageerror = fail;

  prepareWorker(worker, image, sources, () => stopped)
    .then((done) => {
      if (!done) return;
      prepared = true;
      send(latest);
    })
    .catch(fail);

  return {
    request(next) {
      latest = next;
      if (broken) {
        if (!stopped) onResult(next.tag, null);
        return;
      }
      if (prepared) send(next);
    },
    dispose() {
      stopped = true;
      worker.terminate();
    },
  };
}
