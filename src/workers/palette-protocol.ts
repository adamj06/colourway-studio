// Messages between the palette UI and the palette worker. Both directions are validated with zod: the worker is
// a trust boundary like any other (pixels and ids come from the page, results come back to it).
import { z } from 'zod';

/** Largest analysis image side the worker accepts. The UI sends at most 600 px; the cap bounds memory regardless. */
export const MAX_IMAGE_SIDE = 1024;
export const MIN_K = 4;
export const MAX_K = 8;

const id = z.number().int().nonnegative();
const k = z.number().int().min(MIN_K).max(MAX_K);

const image = z
  .object({
    width: z.number().int().min(1).max(MAX_IMAGE_SIDE),
    height: z.number().int().min(1).max(MAX_IMAGE_SIDE),
    data: z.instanceof(Uint8ClampedArray),
  })
  .refine((value) => value.data.length === value.width * value.height * 4, {
    message: 'data length must be width * height * 4 (RGBA)',
    path: ['data'],
  });

/** One Lab colour: three finite numbers. */
export const lab = z.tuple([z.number(), z.number(), z.number()]);

export const requestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('analyse'), id, k, image }),
  z.object({ type: z.literal('set-k'), id, k }),
  // A palette that came from a share link: measure how much of `image` each of these swatches covers.
  z.object({ type: z.literal('shares'), id, labs: z.array(lab).min(1).max(MAX_K), image }),
]);

const swatch = z.object({
  hex: z.string().regex(/^#[0-9A-F]{6}$/),
  lab: z.tuple([z.number(), z.number(), z.number()]),
  share: z.number().min(0).max(1),
});

export const responseSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('palette'), id, k, swatches: z.array(swatch).max(MAX_K) }),
  z.object({ type: z.literal('shares'), id, shares: z.array(z.number().min(0).max(1)).max(MAX_K) }),
  z.object({ type: z.literal('error'), id: id.nullable(), message: z.string() }),
]);

export type PaletteRequest = z.infer<typeof requestSchema>;
export type PaletteResponse = z.infer<typeof responseSchema>;
