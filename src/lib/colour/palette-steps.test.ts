import { describe, expect, it } from 'vitest';

import { bands, buildImage, checkerboard } from '../../../tests/helpers/colour';
import { kmeansLab } from './kmeans';
import { extractPaletteFromSamples, extractPaletteSteps } from './palette';
import { mulberry32 } from './prng';
import { sampleLabPixels } from './sample';
import type { PixelBuffer, Swatch } from './types';

function noisyImage(): PixelBuffer {
  const rng = mulberry32(11);
  return buildImage(24, 24, () => ({
    rgb: [Math.floor(rng() * 256), Math.floor(rng() * 256), Math.floor(rng() * 256)],
  }));
}

const images: [string, () => PixelBuffer][] = [
  ['the checkerboard', () => checkerboard('#C0392B', '#2E86C1', 16)],
  ['a noisy image', noisyImage],
  [
    'the 70/20/10 bands',
    () =>
      bands(10, [
        { hex: '#C0392B', rows: 7 },
        { hex: '#2E86C1', rows: 2 },
        { hex: '#27AE60', rows: 1 },
      ]),
  ],
];

function drain(gen: Generator<void, Swatch[] | null, void>): { value: Swatch[] | null; yields: number } {
  let yields = 0;
  for (;;) {
    const step = gen.next();
    if (step.done === true) return { value: step.value, yields };
    yields++;
  }
}

describe('extractPaletteSteps: same output as extractPaletteFromSamples', () => {
  it.each(images)('matches for %s', (_name, make) => {
    const samples = sampleLabPixels(make());
    for (const k of [2, 3, 6]) {
      const { value } = drain(extractPaletteSteps(samples, { k }));
      expect(value).toEqual(extractPaletteFromSamples(samples, { k }));
    }
  });

  it('respects a custom seed', () => {
    const samples = sampleLabPixels(noisyImage());
    expect(drain(extractPaletteSteps(samples, { k: 5, seed: 99 })).value).toEqual(
      extractPaletteFromSamples(samples, { k: 5, seed: 99 }),
    );
  });

  it('returns an empty palette without yielding for empty samples', () => {
    expect(drain(extractPaletteSteps(new Float64Array(0), { k: 4 }))).toEqual({ value: [], yields: 0 });
  });

  it('does not mutate the input samples', () => {
    const samples = sampleLabPixels(noisyImage());
    const copy = samples.slice();
    drain(extractPaletteSteps(samples, { k: 5 }));
    expect(samples).toEqual(copy);
  });
});

describe('extractPaletteSteps: yields', () => {
  it('yields one fewer time than the k-means iteration count', () => {
    const samples = sampleLabPixels(noisyImage());
    const iterations = kmeansLab(samples, 6, mulberry32(1))?.iterations ?? 0;
    expect(iterations).toBeGreaterThan(1);
    expect(drain(extractPaletteSteps(samples, { k: 6 })).yields).toBe(iterations - 1);
  });
});

describe('extractPaletteSteps: shouldStop', () => {
  it('returns null when shouldStop flips to true mid-run', () => {
    const samples = sampleLabPixels(noisyImage());
    let stop = false;
    const gen = extractPaletteSteps(samples, { k: 6, shouldStop: () => stop });
    expect(gen.next().done).toBe(false);
    stop = true;
    expect(gen.next()).toEqual({ done: true, value: null });
  });

  it('returns null at once when shouldStop is already true', () => {
    const samples = sampleLabPixels(noisyImage());
    expect(extractPaletteSteps(samples, { k: 6, shouldStop: () => true }).next()).toEqual({
      done: true,
      value: null,
    });
  });
});

describe('extractPaletteSteps: invalid k', () => {
  it.each([0, -1, 1.5, Number.NaN])('throws RangeError on the first next() for k = %s', (k) => {
    const gen = extractPaletteSteps(sampleLabPixels(noisyImage()), { k });
    expect(() => gen.next()).toThrow(RangeError);
  });

  it('extractPaletteFromSamples still throws RangeError synchronously', () => {
    expect(() => extractPaletteFromSamples(new Float64Array(3), { k: 0 })).toThrow(RangeError);
  });
});
