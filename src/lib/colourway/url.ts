// The colourway in a URL: `cw=1F3A2B.C04030~E0D0A0`. Swatches are dot-separated; a swatch is its original colour, or
// original~edit. No '#'. Pure, no DOM, no throwing: anything unreadable decodes to null.
import { initialColourway, type ColourwayState } from './state';

export const MAX_SWATCHES = 8;
export const MAX_ENCODED_LENGTH = 128;

const HEX6 = /^[0-9a-fA-F]{6}$/;

export function encodeColourway(state: ColourwayState): string {
  return state.original
    .map((hex, index) => {
      const original = hex.slice(1).toUpperCase();
      const edit = state.edits[index];
      return edit === undefined ? original : `${original}~${edit.slice(1).toUpperCase()}`;
    })
    .join('.');
}

function parseSwatch(segment: string): { original: string; edit: string | null } | null {
  const parts = segment.split('~');
  if (parts.length > 2 || !parts.every((part) => HEX6.test(part))) return null;
  const [original, edit] = parts;
  if (original === undefined) return null;
  return { original: `#${original.toUpperCase()}`, edit: edit === undefined ? null : `#${edit.toUpperCase()}` };
}

export function decodeColourway(value: string): ColourwayState | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ENCODED_LENGTH) return null;
  const segments = value.split('.');
  if (segments.length > MAX_SWATCHES) return null;
  const swatches = segments.map(parseSwatch);
  if (swatches.some((swatch) => swatch === null)) return null;
  const edits: Record<number, string> = {};
  swatches.forEach((swatch, index) => {
    // An edit equal to its original is no edit, the same rule the reducer applies.
    if (swatch?.edit && swatch.edit !== swatch.original) edits[index] = swatch.edit;
  });
  return { ...initialColourway(swatches.map((swatch) => swatch?.original ?? '')), edits };
}
