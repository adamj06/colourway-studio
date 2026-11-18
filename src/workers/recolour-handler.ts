// The logic of the recolour worker, free of worker globals so it can be unit tested in node.
// 'prepare' caches the image's Lab pixels and blend weights (they depend only on the image and the source palette);
// each 'recolour' then only applies the shifts, so dragging a colour picker is cheap.
import { applyShifts, blendWeights, labPixels, shiftsOf } from '../lib/colour/recolour';
import type { Lab } from '../lib/colour/types';
import { macrotask } from './macrotask';
import { requestSchema, type RecolourResponse } from './recolour-protocol';

export type RecolourHandlerDeps = {
  /** Lets newer messages be delivered before a run posts. Defaults to a macrotask yield. */
  yieldTick?: () => Promise<void>;
};

export type RecolourHandler = {
  handle(request: unknown, post: (response: RecolourResponse) => void): Promise<void>;
};

type Prepared = {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  labs: Float64Array;
  weights: Float64Array;
  sources: Lab[];
};

function idOf(request: unknown): number | null {
  if (typeof request !== 'object' || request === null || !('id' in request)) return null;
  const value = request.id;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export function createRecolourHandler(deps: RecolourHandlerDeps = {}): RecolourHandler {
  const yieldTick = deps.yieldTick ?? macrotask;
  let prepared: Prepared | null = null;
  // Each recolour takes a ticket; only the call holding the latest ticket may post. A superseded one is silent.
  let latest = 0;

  async function recolour(id: number, targets: Lab[], ticket: number, post: (r: RecolourResponse) => void) {
    if (prepared === null) {
      post({ type: 'error', id, message: 'No image has been prepared yet.' });
      return;
    }
    if (targets.length !== prepared.sources.length) {
      post({ type: 'error', id, message: 'The number of targets must match the prepared palette.' });
      return;
    }
    const { width, height, rgba, labs, weights, sources } = prepared;
    await yieldTick();
    if (latest !== ticket) return;
    const data = applyShifts(rgba, labs, weights, shiftsOf(sources, targets));
    post({ type: 'image', id, width, height, data });
  }

  return {
    async handle(request, post) {
      const parsed = requestSchema.safeParse(request);
      if (!parsed.success) {
        post({ type: 'error', id: idOf(request), message: 'Invalid recolour request.' });
        return;
      }
      const message = parsed.data;
      try {
        if (message.type === 'prepare') {
          // Copy: the cache must not change if the caller reuses its buffer.
          const rgba = new Uint8ClampedArray(message.image.data);
          const labs = labPixels(rgba);
          const { width, height } = message.image;
          prepared = {
            width,
            height,
            rgba,
            labs,
            weights: blendWeights(labs, message.sources),
            sources: message.sources,
          };
          return;
        }
        await recolour(message.id, message.targets, ++latest, post);
      } catch {
        post({ type: 'error', id: message.id, message: 'Recolouring failed.' });
      }
    },
  };
}
