import type { Swatch } from '@/lib/colour/types';
import { responseSchema } from '@/workers/palette-protocol';
import { postShares, postSnapshot, snapshotImage, type Snapshot } from './paletteImage';

/** What the UI wants analysed. `tag` identifies the state the answer belongs to (it comes back with the result). */
export type PaletteRequest = { k: number; tag: string };

/** A palette that is already known (from a share link): its colours, whose shares the worker will measure. */
export type KnownSwatch = { hex: string; lab: Swatch['lab'] };

export type PaletteClient = {
  /** Ask for a palette with a new k. A request still running in the worker is superseded and never shown. */
  request: (next: PaletteRequest) => void;
  dispose: () => void;
};

type Answer = { kind: 'fail' } | { kind: 'answer'; id: number; swatches: Swatch[] | null };

/** The known swatches with the shares the worker measured, or a failure if the counts do not match. */
function withShares(known: readonly KnownSwatch[], shares: readonly number[]): Swatch[] | null {
  if (known.length !== shares.length) return null;
  return known.map((swatch, index) => ({ ...swatch, share: shares[index] ?? 0 }));
}

/** A response that does not match the protocol, or an error with no request id, counts as a failure. */
function interpret(data: unknown, known: readonly KnownSwatch[] | null): Answer {
  const parsed = responseSchema.safeParse(data);
  if (!parsed.success || parsed.data.id === null) return { kind: 'fail' };
  const { id } = parsed.data;
  if (parsed.data.type === 'palette') return { kind: 'answer', id, swatches: parsed.data.swatches };
  if (parsed.data.type === 'shares') {
    return known === null ? { kind: 'fail' } : { kind: 'answer', id, swatches: withShares(known, parsed.data.shares) };
  }
  return { kind: 'answer', id, swatches: null };
}

function releaseSnapshot(snapshot: Snapshot): void {
  if (snapshot.kind === 'bitmap') snapshot.bitmap.close();
}

/**
 * Posts the first request: extract a palette, or (for a palette that came from a share link) measure the known
 * swatches. Either way the worker keeps the samples, so a later change of k needs no second image. A bitmap that
 * could not be transferred is still ours to release.
 */
function postFirst(worker: Worker, snapshot: Snapshot, id: number, k: number, known: readonly KnownSwatch[] | null) {
  try {
    if (known === null) postSnapshot(worker, snapshot, id, k);
    else
      postShares(
        worker,
        snapshot,
        id,
        known.map((swatch) => swatch.lab),
      );
  } catch (error) {
    releaseSnapshot(snapshot);
    throw error;
  }
}

/** Hands out request ids and remembers which tag each belongs to. Only the newest request's answer is ever shown. */
function createRequestTracker() {
  const tags = new Map<number, string>();
  let nextId = 0;
  let newestId = -1;
  return {
    start(request: PaletteRequest): number {
      newestId = nextId++;
      tags.set(newestId, request.tag);
      return newestId;
    },
    tagIfNewest: (id: number): string | undefined => (id === newestId ? tags.get(id) : undefined),
  };
}

function openWorker(onFailure: () => void): Worker {
  const worker = new Worker(new URL('../../workers/palette.worker.ts', import.meta.url), { type: 'module' });
  worker.onerror = onFailure;
  worker.onmessageerror = onFailure;
  return worker;
}

/**
 * Owns one palette worker for one loaded image. The worker is created here, lazily, so the colour code is only
 * downloaded on the design page. `onResult` gets swatches, or null when extraction failed.
 */
export function createPaletteClient(
  image: HTMLImageElement,
  first: PaletteRequest,
  onResult: (tag: string, swatches: Swatch[] | null) => void,
  /** Read when the first snapshot is posted, so a k chosen before then is honoured (see usePalette). */
  known: () => readonly KnownSwatch[] | null = () => null,
): PaletteClient {
  // What the first request measured, if it was a palette from a link: needed to read the answer.
  let measuring: readonly KnownSwatch[] | null = null;
  const requests = createRequestTracker();
  let latest = first;
  let analysed = false;
  let stopped = false;
  // Once the image or worker has failed, later k changes answer with the failure at once instead of waiting forever.
  let broken = false;
  const fail = () => {
    broken = true;
    worker.terminate();
    if (!stopped) onResult(latest.tag, null);
  };
  // `fail` only runs after the worker exists (it is an event handler), so the order here is safe.
  const worker = openWorker(fail);

  worker.onmessage = (event: MessageEvent<unknown>) => {
    const answer = interpret(event.data, measuring);
    if (answer.kind === 'fail') {
      fail();
      return;
    }
    // Late answers to superseded requests are ignored: only the newest request id is ever shown.
    const tag = requests.tagIfNewest(answer.id);
    if (stopped || tag === undefined) return;
    onResult(tag, answer.swatches);
  };

  snapshotImage(image)
    .then((snapshot) => {
      if (stopped) {
        releaseSnapshot(snapshot);
        return;
      }
      measuring = known();
      postFirst(worker, snapshot, requests.start(latest), latest.k, measuring);
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
      if (analysed) worker.postMessage({ type: 'set-k', id: requests.start(next), k: next.k });
    },
    dispose() {
      stopped = true;
      worker.terminate();
    },
  };
}
