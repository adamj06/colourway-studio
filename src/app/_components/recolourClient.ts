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

/** The prepare message's id: recolour requests are numbered from 1. */
const PREPARE_ID = 0;

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

/** How long the targets must stay unchanged before the full-quality frame is asked for. */
export const SETTLE_MS = 250;

type Quality = 'preview' | 'final';
type Queued = { request: RecolourRequest; quality: Quality };

/**
 * Every change is drawn from a cheap preview; once nothing has changed for SETTLE_MS the full-quality frame follows
 * (a colour picker being dragged only ever gets previews). The timer restarts on each change.
 */
function createSettler(queue: (queued: Queued) => void, isLive: () => boolean) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    clearTimeout(timer);
  };
  return {
    cancel,
    change(request: RecolourRequest) {
      queue({ request, quality: 'preview' });
      cancel();
      timer = setTimeout(() => {
        if (isLive()) queue({ request, quality: 'final' });
      }, SETTLE_MS);
    },
  };
}

/** The one request in the worker and the newest change waiting behind it. Ids count up from 1 (0 is the prepare). */
function createSendQueue(post: (id: number, queued: Queued) => void, canSend: () => boolean) {
  let nextId = PREPARE_ID;
  let inFlight: { id: number; tag: string } | null = null;
  let waiting: Queued | null = null;
  const pump = () => {
    if (!canSend() || inFlight !== null || waiting === null) return;
    const queued = waiting;
    waiting = null;
    inFlight = { id: ++nextId, tag: queued.request.tag };
    post(inFlight.id, queued);
  };
  return {
    pump,
    queue: (queued: Queued) => {
      waiting = queued;
      pump();
    },
    /** The tag of the request `id` answers, if it is the one in flight (which then ends); undefined for anything else. */
    answered(id: number): string | undefined {
      if (inFlight?.id !== id) return undefined;
      const { tag } = inFlight;
      inFlight = null;
      return tag;
    },
  };
}

/**
 * Owns one recolour worker for one loaded image and one source palette. The worker is created here, lazily, so
 * none of this is downloaded until a colour is first changed. `onResult` gets a frame, or null when it failed.
 *
 * At most one recolour is in the worker at a time and only the newest change waits behind it. When an answer
 * arrives it is drawn (it was the newest request sent) and the waiting change, if any, goes next. Sending every
 * input event straight away instead would make each answer stale before it arrived, so nothing would paint while a
 * picker is being dragged.
 */
export function createRecolourClient(
  image: HTMLImageElement,
  sources: Lab[],
  first: RecolourRequest,
  onResult: (tag: string, frame: Frame | null) => void,
): RecolourClient {
  const worker = new Worker(new URL('../../workers/recolour.worker.ts', import.meta.url), { type: 'module' });
  let latest = first;
  let prepared = false;
  let stopped = false;
  let broken = false;

  const sender = createSendQueue(
    (id, { request, quality }) => {
      worker.postMessage({ type: 'recolour', id, targets: request.targets, quality });
    },
    () => prepared && !stopped && !broken,
  );
  const settler = createSettler(sender.queue, () => !stopped && !broken);
  const fail = () => {
    broken = true;
    settler.cancel();
    worker.terminate();
    if (!stopped) onResult(latest.tag, null);
  };

  worker.onmessage = (event: MessageEvent<unknown>) => {
    const answer = interpret(event.data);
    if (answer.kind === 'fail' || (answer.id === PREPARE_ID && answer.frame === null)) {
      fail();
      return;
    }
    // Only the answer to the request in flight is drawn: anything else (late, or for another request) is ignored.
    const tag = stopped ? undefined : sender.answered(answer.id);
    if (tag === undefined) return;
    onResult(tag, answer.frame);
    sender.pump();
  };
  worker.onerror = fail;
  worker.onmessageerror = fail;

  prepareWorker(worker, image, sources, () => stopped)
    .then((done) => {
      if (!done) return;
      prepared = true;
      settler.change(latest);
    })
    .catch(fail);

  return {
    request(next) {
      latest = next;
      if (broken) {
        if (!stopped) onResult(next.tag, null);
        return;
      }
      if (prepared) settler.change(next);
    },
    dispose() {
      stopped = true;
      settler.cancel();
      worker.terminate();
    },
  };
}
