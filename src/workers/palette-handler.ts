// The logic of the palette worker, free of worker globals so it can be unit tested in node.
// palette.worker.ts is a thin wrapper that feeds it messages.
import { extractPaletteSteps } from '../lib/colour/palette';
import { sampleLabPixels } from '../lib/colour/sample';
import { macrotask } from './macrotask';
import { requestSchema, type PaletteRequest, type PaletteResponse } from './palette-protocol';

export type PaletteHandlerDeps = {
  /** Lets newer messages be delivered before a run finishes. Defaults to a macrotask yield. */
  yieldTick?: () => Promise<void>;
};

export type PaletteHandler = {
  handle(request: unknown, post: (response: PaletteResponse) => void): Promise<void>;
};

function idOf(request: unknown): number | null {
  if (typeof request !== 'object' || request === null || !('id' in request)) return null;
  const value = request.id;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export function createPaletteHandler(deps: PaletteHandlerDeps = {}): PaletteHandler {
  const yieldTick = deps.yieldTick ?? macrotask;
  let samples: Float64Array | null = null;
  // Each handle() call takes a ticket; only the call holding the latest ticket may post. A superseded run is silent.
  let latest = 0;

  async function run(request: PaletteRequest, ticket: number, post: (r: PaletteResponse) => void): Promise<void> {
    const isStale = () => latest !== ticket;
    // Only a valid analyse replaces the cache, and only after validation, so a bad request can't wipe a good image.
    if (request.type === 'analyse') samples = sampleLabPixels(request.image);
    if (samples === null) {
      post({ type: 'error', id: request.id, message: 'No image has been analysed yet.' });
      return;
    }
    await yieldTick();
    if (isStale()) return;
    // One k-means iteration per step. Yielding between steps lets a newer message arrive; shouldStop then abandons
    // this run at the start of its next iteration, so a superseded run costs at most one more iteration.
    const steps = extractPaletteSteps(samples, { k: request.k, shouldStop: isStale });
    let step = steps.next();
    while (step.done !== true) {
      await yieldTick();
      step = steps.next();
    }
    const swatches = step.value;
    if (swatches === null || isStale()) return;
    post({ type: 'palette', id: request.id, k: request.k, swatches: swatches.map((s) => ({ ...s, lab: [...s.lab] })) });
  }

  return {
    async handle(request, post) {
      const parsed = requestSchema.safeParse(request);
      if (!parsed.success) {
        post({ type: 'error', id: idOf(request), message: 'Invalid palette request.' });
        return;
      }
      const ticket = ++latest;
      try {
        await run(parsed.data, ticket, post);
      } catch {
        if (latest === ticket) post({ type: 'error', id: parsed.data.id, message: 'Palette extraction failed.' });
      }
    },
  };
}
