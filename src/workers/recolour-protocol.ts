// Messages between the recolour UI and the recolour worker. Both directions are validated with zod: the worker is a
// trust boundary like any other (pixels and ids come from the page, results come back to it).
import { z } from 'zod';
import { MAX_K } from './palette-protocol';

/** Largest image side the worker accepts. The UI sends at most 1600 px; the cap bounds memory regardless. */
export const MAX_RECOLOUR_SIDE = 2048;

/** A palette can have fewer swatches than the k that was asked for (the image has fewer than k clearly different colours, even after extraction tops up), down to one. */
export const MIN_SWATCHES = 1;

const id = z.number().int().nonnegative();
const side = z.number().int().min(1).max(MAX_RECOLOUR_SIDE);
const lab = z.tuple([z.number(), z.number(), z.number()]);
const labs = z.array(lab).min(MIN_SWATCHES).max(MAX_K);

const image = z
  .object({ width: side, height: side, data: z.instanceof(Uint8ClampedArray) })
  .refine((value) => value.data.length === value.width * value.height * 4, {
    message: 'data length must be width * height * 4 (RGBA)',
    path: ['data'],
  });

/**
 * 'preview' is for the frames drawn while a colour is being dragged (a coarser, much cheaper table); 'final' is for
 * when it has settled. A request without one is final.
 */
export const qualitySchema = z.enum(['preview', 'final']);

export const requestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('prepare'), id, image, sources: labs }),
  z.object({ type: z.literal('recolour'), id, targets: labs, quality: qualitySchema.optional() }),
]);

export const responseSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('image'), id, width: side, height: side, data: z.instanceof(Uint8ClampedArray) }),
  z.object({ type: z.literal('error'), id: id.nullable(), message: z.string() }),
]);

export type RecolourRequest = z.infer<typeof requestSchema>;
export type RecolourResponse = z.infer<typeof responseSchema>;
