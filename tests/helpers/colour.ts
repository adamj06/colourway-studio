import { readFileSync } from 'node:fs';
import path from 'node:path';

import { hexToRgb } from '../../src/lib/colour/convert';
import type { Lab, PixelBuffer, Rgb } from '../../src/lib/colour/types';

const DIR = path.resolve(import.meta.dirname, '..', 'fixtures', 'colour');

export type SharmaPair = { pair: number; lab1: Lab; lab2: Lab; deltaE: number };
export type LabOracleEntry = { name: string; rgb: Rgb; lab: Lab };

function readText(name: string): string {
  return readFileSync(path.join(DIR, name), 'utf8');
}

export function loadSharmaPairs(): SharmaPair[] {
  const parsed = JSON.parse(readText('sharma-2005.json')) as { pairs: SharmaPair[] };
  return parsed.pairs;
}

export function loadRawSharmaText(): string {
  return readText('ciede2000testdata.txt');
}

export function loadLabOracle(): LabOracleEntry[] {
  const parsed = JSON.parse(readText('srgb-lab-reference.json')) as { colours: LabOracleEntry[] };
  return parsed.colours;
}

/** Builds an RGBA buffer whose pixel at (x, y) is chosen by `pick`. alpha defaults to 255. */
export function buildImage(
  width: number,
  height: number,
  pick: (x: number, y: number) => { rgb: Rgb; alpha?: number },
): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { rgb, alpha = 255 } = pick(x, y);
      const o = (y * width + x) * 4;
      data[o] = rgb[0];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[2];
      data[o + 3] = alpha;
    }
  }
  return { data, width, height };
}

export function solidImage(width: number, height: number, rgb: Rgb, alpha = 255): PixelBuffer {
  return buildImage(width, height, () => ({ rgb, alpha }));
}

/** Even-sized checkerboard of two hex colours. */
export function checkerboard(hexA: string, hexB: string, size = 16): PixelBuffer {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return buildImage(size, size, (x, y) => ({ rgb: (x + y) % 2 === 0 ? a : b }));
}

/** Horizontal bands: each entry gets `rows` full-width rows. */
export function bands(width: number, entries: { hex: string; rows: number }[]): PixelBuffer {
  const total = entries.reduce((n, e) => n + e.rows, 0);
  return buildImage(width, total, (_x, y) => {
    let remaining = y;
    for (const e of entries) {
      if (remaining < e.rows) return { rgb: hexToRgb(e.hex) };
      remaining -= e.rows;
    }
    throw new Error('row out of range');
  });
}
