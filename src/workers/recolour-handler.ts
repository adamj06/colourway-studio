// The logic of the recolour worker, free of worker globals so it can be unit tested in node.
// 'prepare' caches a copy of the image and the source palette. Each 'recolour' builds a lookup table for the current
// targets and runs every pixel through it (trilinear). A 'preview' uses a 33^3 table (cheap enough to follow a colour
// picker being dragged), a 'final' a 65^3 one (within deltaE2000 2.5 of the exact recolour).
import { applyLut, createLutBuilder, type RecolourLutBuilder } from '../lib/colour/recolour';
import type { Lab } from '../lib/colour/types';
import { macrotask } from './macrotask';
import { requestSchema, type RecolourResponse } from './recolour-protocol';

type Quality = 'preview' | 'final';
const LUT_SIZE: Record<Quality, number> = { preview: 33, final: 65 };

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
  sources: Lab[];
  /** Table builders hold per-palette work, so each is made on first use and kept until the next prepare. */
  builders: Partial<Record<Quality, RecolourLutBuilder>>;
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

  async function recolour(
    { id, targets, quality = 'final' }: { id: number; targets: Lab[]; quality?: Quality | undefined },
    ticket: number,
    post: (r: RecolourResponse) => void,
  ) {
    if (prepared === null) {
      post({ type: 'error', id, message: 'No image has been prepared yet.' });
      return;
    }
    if (targets.length !== prepared.sources.length) {
      post({ type: 'error', id, message: 'The number of targets must match the prepared palette.' });
      return;
    }
    const { width, height, rgba, sources, builders } = prepared;
    await yieldTick();
    if (latest !== ticket) return;
    const size = LUT_SIZE[quality];
    const builder = (builders[quality] ??= createLutBuilder(sources, size));
    const data = applyLut(rgba, builder(targets), size);
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
          // A recolour still waiting belonged to the previous image: it must not be answered with it.
          latest++;
          // Copy: the cache must not change if the caller reuses its buffer.
          const rgba = new Uint8ClampedArray(message.image.data);
          const { width, height } = message.image;
          prepared = { width, height, rgba, sources: message.sources, builders: {} };
          return;
        }
        await recolour(message, ++latest, post);
      } catch {
        post({ type: 'error', id: message.id, message: 'Recolouring failed.' });
      }
    },
  };
}
