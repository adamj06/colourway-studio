import type { z } from 'zod';

export const requestSchema: z.ZodType<PaletteRequest> = {
  safeParse: () => {
    throw new Error('not implemented');
  },
} as unknown as z.ZodType<PaletteRequest>;

export const responseSchema: z.ZodType<PaletteResponse> = {
  safeParse: () => {
    throw new Error('not implemented');
  },
} as unknown as z.ZodType<PaletteResponse>;

export type PaletteRequest =
  | { type: 'analyse'; id: number; k: number; image: { width: number; height: number; data: Uint8ClampedArray } }
  | { type: 'set-k'; id: number; k: number };

export type PaletteResponse =
  | {
      type: 'palette';
      id: number;
      k: number;
      swatches: { hex: string; lab: [number, number, number]; share: number }[];
    }
  | { type: 'error'; id: number | null; message: string };
