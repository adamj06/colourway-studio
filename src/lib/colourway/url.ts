// The colourway in a URL: `cw=1F3A2B.C04030~E0D0A0`. Swatches are dot-separated; a swatch is its original colour, or
// original~edit. No '#'. Pure, no DOM, no throwing: anything unreadable decodes to null (ADR 0005).
import { z } from 'zod';
import { initialColourway, type ColourwayState } from './state';

export const MAX_SWATCHES = 8;
export const MAX_ENCODED_LENGTH = 128;

const SWATCH = '[0-9a-f]{6}(?:~[0-9a-f]{6})?';
/** The whole grammar, so nothing but hex, dots and tildes ever gets past: 1 to 8 swatches. */
const encodedSchema = z
  .string()
  .max(MAX_ENCODED_LENGTH)
  .regex(new RegExp(`^${SWATCH}(?:\\.${SWATCH}){0,${String(MAX_SWATCHES - 1)}}$`, 'i'));

export function encodeColourway(state: ColourwayState): string {
  return state.original
    .map((hex, index) => {
      const original = hex.slice(1).toUpperCase();
      const edit = state.edits[index];
      return edit === undefined ? original : `${original}~${edit.slice(1).toUpperCase()}`;
    })
    .join('.');
}

export function decodeColourway(value: string): ColourwayState | null {
  const parsed = encodedSchema.safeParse(value);
  if (!parsed.success) return null;
  const originals: string[] = [];
  const edits: Record<number, string> = {};
  parsed.data.split('.').forEach((segment, index) => {
    const [original = '', edit] = segment.split('~');
    originals.push(`#${original.toUpperCase()}`);
    // An edit equal to its original is no edit, the same rule the reducer applies.
    if (edit !== undefined && edit.toUpperCase() !== original.toUpperCase()) edits[index] = `#${edit.toUpperCase()}`;
  });
  return { ...initialColourway(originals), edits };
}

export type ColourwayParam = { kind: 'none' } | { kind: 'invalid' } | { kind: 'ok'; state: ColourwayState };

/**
 * `href` with its `cw` parameter set to `encoded` (null removes it). Every other parameter, the path and the hash are
 * kept as they were. The value is written as is: URLSearchParams would escape the '~'. Throws a TypeError for a
 * string that is not an absolute URL.
 */
export function colourwayHref(href: string, encoded: string | null): string {
  const url = new URL(href);
  const kept = url.search
    .slice(1)
    .split('&')
    .filter((part) => part !== '' && part.split('=')[0] !== 'cw');
  if (encoded !== null) kept.push(`cw=${encoded}`);
  url.search = kept.join('&');
  return url.toString();
}

/** Reads `cw` from a query string (with or without the leading '?'). The first `cw` wins. */
export function readColourwayParam(search: string): ColourwayParam {
  const value = new URLSearchParams(search).get('cw');
  if (value === null) return { kind: 'none' };
  const state = decodeColourway(value);
  return state === null ? { kind: 'invalid' } : { kind: 'ok', state };
}
