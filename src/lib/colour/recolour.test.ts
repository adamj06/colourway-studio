import { describe, expect, it } from 'vitest';

import { hexToRgb, labToRgb, rgbToLab } from './convert';
import { deltaE2000 } from './delta-e';
import { mulberry32 } from './prng';
import { applyShifts, blendWeights, labPixels, recolour } from './recolour';
import type { Lab, Rgb } from './types';

const labOf = (hex: string): Lab => rgbToLab(hexToRgb(hex));

/** Builds RGBA bytes from RGB triples, with one alpha for all or one per pixel. */
function rgba(pixels: readonly Rgb[], alpha: number | readonly number[] = 255): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b], i) => {
    out.set([r, g, b, typeof alpha === 'number' ? alpha : (alpha[i] ?? 255)], i * 4);
  });
  return out;
}

function pixelAt(data: Uint8ClampedArray, i: number): Rgb {
  return [data[i * 4] ?? -1, data[i * 4 + 1] ?? -1, data[i * 4 + 2] ?? -1];
}

const labAt = (data: Uint8ClampedArray, i: number): Lab => rgbToLab(pixelAt(data, i));

function randomPixels(count: number, seed: number): Rgb[] {
  const rng = mulberry32(seed);
  return Array.from({ length: count }, () => [
    Math.floor(rng() * 256),
    Math.floor(rng() * 256),
    Math.floor(rng() * 256),
  ]);
}

function expectWithin(actual: Uint8ClampedArray, expected: Uint8ClampedArray, tolerance: number): void {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(Math.abs((actual[i] ?? 999) - (expected[i] ?? -999))).toBeLessThanOrEqual(tolerance);
  }
}

const RED = '#C0392B';
const BLUE = '#2E86C1';
const GREEN = '#27AE60';
const GOLD = '#F1C40F';

describe('labPixels', () => {
  it('returns three numbers per pixel matching rgbToLab', () => {
    const pixels: Rgb[] = [
      [255, 255, 255],
      [0, 0, 0],
      [192, 57, 43],
      [46, 134, 193],
    ];
    const labs = labPixels(rgba(pixels));
    expect(labs).toHaveLength(12);
    pixels.forEach((p, i) => {
      const expected = rgbToLab(p);
      expect(labs[i * 3]).toBeCloseTo(expected[0], 3);
      expect(labs[i * 3 + 1]).toBeCloseTo(expected[1], 3);
      expect(labs[i * 3 + 2]).toBeCloseTo(expected[2], 3);
    });
  });

  it('ignores alpha when computing Lab', () => {
    const a = labPixels(rgba([[10, 200, 90]], 255));
    const b = labPixels(rgba([[10, 200, 90]], 3));
    expect([...b]).toEqual([...a]);
  });

  it('returns an empty array for an empty image', () => {
    expect(labPixels(new Uint8ClampedArray(0))).toHaveLength(0);
  });

  it('does not mutate its input', () => {
    const input = rgba(randomPixels(20, 1));
    const copy = Uint8ClampedArray.from(input);
    labPixels(input);
    expect([...input]).toEqual([...copy]);
  });
});

describe('blendWeights', () => {
  const sources: Lab[] = [labOf(RED), labOf(BLUE), labOf(GREEN), labOf(GOLD)];

  it('gives each pixel one weight per swatch', () => {
    const labs = labPixels(rgba(randomPixels(9, 2)));
    expect(blendWeights(labs, sources)).toHaveLength(9 * sources.length);
  });

  it('normalises the weights of every pixel to sum to 1 and keeps them within 0..1', () => {
    const labs = labPixels(rgba(randomPixels(200, 3)));
    const weights = blendWeights(labs, sources);
    for (let p = 0; p < 200; p++) {
      let sum = 0;
      for (let s = 0; s < sources.length; s++) {
        const w = weights[p * sources.length + s] ?? Number.NaN;
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
        sum += w;
      }
      expect(sum).toBeCloseTo(1, 6);
    }
  });

  it('gives weight 1 to the swatch a pixel sits on, and 0 to the others', () => {
    const labs = labPixels(rgba([hexToRgb(RED), hexToRgb(BLUE), hexToRgb(GOLD)]));
    const weights = blendWeights(labs, sources);
    expect(weights[0]).toBeCloseTo(1, 6);
    expect(weights[1 * 4 + 1]).toBeCloseTo(1, 6);
    expect(weights[2 * 4 + 3]).toBeCloseTo(1, 6);
    expect(weights[1]).toBeCloseTo(0, 6);
  });

  it('weights by inverse distance to the fourth power (distance 10 versus 20 gives 16/17 and 1/17)', () => {
    const labs = Float64Array.from([50, 0, 0]);
    const weights = blendWeights(labs, [
      [60, 0, 0],
      [50, 20, 0],
    ]);
    expect(weights[0]).toBeCloseTo(16 / 17, 9);
    expect(weights[1]).toBeCloseTo(1 / 17, 9);
  });

  it('gives a nearer swatch a larger weight than a farther one', () => {
    const labs = Float64Array.from([50, 10, 10]);
    const weights = blendWeights(labs, [
      [50, 12, 10],
      [50, 40, 10],
      [90, 0, 0],
    ]);
    expect(weights[0]).toBeGreaterThan(weights[1] ?? 1);
    expect(weights[1]).toBeGreaterThan(weights[2] ?? 1);
  });

  it('gives weight 1 to the only swatch', () => {
    const weights = blendWeights(labPixels(rgba(randomPixels(5, 4))), [labOf(RED)]);
    expect([...weights].every((w) => Math.abs(w - 1) < 1e-9)).toBe(true);
  });

  it('splits evenly between two identical swatches and stays finite', () => {
    const weights = blendWeights(Float64Array.from([50, 0, 0]), [
      [60, 0, 0],
      [60, 0, 0],
    ]);
    expect(weights[0]).toBeCloseTo(0.5, 9);
    expect(weights[1]).toBeCloseTo(0.5, 9);
  });
});

describe('recolour: errors', () => {
  const s = [labOf(RED), labOf(BLUE)];

  it('throws RangeError when the pixel data length is not a multiple of 4', () => {
    expect(() => recolour(new Uint8ClampedArray(7), s, s)).toThrow(RangeError);
  });

  it('throws RangeError when there are no swatches', () => {
    expect(() => recolour(rgba([[1, 2, 3]]), [], [])).toThrow(RangeError);
  });

  it('throws RangeError when sources and targets differ in length', () => {
    expect(() => recolour(rgba([[1, 2, 3]]), s, [labOf(GREEN)])).toThrow(RangeError);
  });

  it('returns an empty array for an empty image', () => {
    expect(recolour(new Uint8ClampedArray(0), s, s)).toHaveLength(0);
  });
});

describe('recolour: identity', () => {
  it('returns every channel within 1 of the input when targets equal sources', () => {
    const input = rgba(randomPixels(500, 5), 255);
    const sources = [labOf(RED), labOf(BLUE), labOf(GREEN), labOf(GOLD), labOf('#8E44AD')];
    expectWithin(recolour(input, sources, sources), input, 1);
  });

  it('stays within 2 of the input after an identity recolour is applied twice', () => {
    const input = rgba(randomPixels(100, 6));
    const sources = [labOf(RED), labOf(BLUE), labOf(GREEN), labOf(GOLD)];
    expectWithin(recolour(recolour(input, sources, sources), sources, sources), input, 2);
  });
});

describe('recolour: swatch colours', () => {
  it('turns a pixel equal to a source swatch into its target within deltaE2000 of 1', () => {
    const sources = [labOf(RED), labOf(BLUE), labOf(GREEN), labOf(GOLD)];
    const targets = [labOf('#2ECC71'), labOf(BLUE), labOf(GREEN), labOf(GOLD)];
    const out = recolour(rgba([hexToRgb(RED)]), sources, targets);
    expect(deltaE2000(labAt(out, 0), targets[0] as Lab)).toBeLessThan(1);
  });

  it('maps each of several swatch-coloured pixels to its own target', () => {
    const sources = [labOf(RED), labOf(BLUE), labOf(GREEN), labOf(GOLD)];
    const targets = ['#2ECC71', '#E67E22', '#8E44AD', '#1ABC9C'].map(labOf);
    const out = recolour(rgba([RED, BLUE, GREEN, GOLD].map(hexToRgb)), sources, targets);
    targets.forEach((t, i) => {
      expect(deltaE2000(labAt(out, i), t)).toBeLessThan(1);
    });
  });
});

describe('recolour: texture', () => {
  const light = labToRgb([60, 10, 10]);
  const dark = labToRgb([50, 10, 10]);
  const source = rgbToLab(labToRgb([55, 10, 10]));
  const lightnessGap = rgbToLab(light)[0] - rgbToLab(dark)[0];

  it('keeps the lightness difference between two pixels near the same swatch', () => {
    const out = recolour(rgba([light, dark]), [source], [labOf('#5A8DC8')]);
    expect(lightnessGap).toBeGreaterThan(8);
    expect(Math.abs(labAt(out, 0)[0] - labAt(out, 1)[0] - lightnessGap)).toBeLessThanOrEqual(1);
  });

  it('keeps that lightness difference when another swatch is far away', () => {
    const out = recolour(rgba([light, dark]), [source, labOf('#00FF00')], [labOf('#5A8DC8'), labOf('#00FF00')]);
    expect(Math.abs(labAt(out, 0)[0] - labAt(out, 1)[0] - lightnessGap)).toBeLessThanOrEqual(1);
  });

  it('does not flatten distinct pixels to one colour', () => {
    const a: Rgb = [200, 60, 50];
    const b: Rgb = [170, 50, 40];
    const out = recolour(rgba([a, b]), [rgbToLab(a)], [labOf('#2E86C1')]);
    expect(pixelAt(out, 0)).not.toEqual(pixelAt(out, 1));
  });
});

describe('recolour: locality', () => {
  const sources = [labOf(RED), labOf(BLUE)];
  const nearRed: Rgb = [196, 60, 46];
  const nearBlue: Rgb = [50, 130, 190];

  it('moves pixels near the edited swatch far more than pixels near an unchanged swatch', () => {
    const out = recolour(rgba([nearRed, nearBlue]), sources, [labOf('#27AE60'), labOf(BLUE)]);
    const movedRed = deltaE2000(rgbToLab(nearRed), labAt(out, 0));
    const movedBlue = deltaE2000(rgbToLab(nearBlue), labAt(out, 1));
    expect(movedRed).toBeGreaterThan(20);
    expect(movedBlue).toBeLessThan(2);
    expect(movedRed).toBeGreaterThan(10 * movedBlue);
  });

  it('leaves a pixel at an unchanged swatch centre within deltaE2000 of 1', () => {
    const out = recolour(rgba([hexToRgb(BLUE)]), sources, [labOf('#27AE60'), labOf(BLUE)]);
    expect(deltaE2000(labOf(BLUE), labAt(out, 0))).toBeLessThan(1);
  });
});

describe('recolour: output format', () => {
  const sources = [labOf(RED), labOf(BLUE)];
  const targets = [labOf('#27AE60'), labOf('#F1C40F')];

  it('leaves alpha untouched and returns the same length', () => {
    const alphas = [0, 1, 128, 255, 7];
    const input = rgba(randomPixels(5, 8), alphas);
    const out = recolour(input, sources, targets);
    expect(out).toHaveLength(input.length);
    expect(alphas.map((_, i) => out[i * 4 + 3])).toEqual(alphas);
  });

  it('clamps an out-of-gamut target to the nearest valid colour', () => {
    const wild: Lab[] = [
      [60, 127, 127],
      [150, 0, 0],
    ];
    const out = recolour(rgba([hexToRgb(RED)]), sources, wild);
    const expected = labToRgb(wild[0] as Lab);
    pixelAt(out, 0).forEach((c, i) => {
      expect(Number.isInteger(c)).toBe(true);
      expect(Math.abs(c - (expected[i] ?? -999))).toBeLessThanOrEqual(1);
    });
  });

  it('does not mutate its input', () => {
    const input = rgba(randomPixels(30, 9));
    const copy = Uint8ClampedArray.from(input);
    recolour(input, sources, targets);
    expect([...input]).toEqual([...copy]);
  });

  it('is deterministic', () => {
    const input = rgba(randomPixels(30, 10));
    expect([...recolour(input, sources, targets)]).toEqual([...recolour(input, sources, targets)]);
  });

  it('equals composing labPixels, blendWeights and applyShifts', () => {
    const input = rgba(randomPixels(40, 11), 200);
    const labs = labPixels(input);
    const weights = blendWeights(labs, sources);
    const shifts: Lab[] = targets.map((t, i) => {
      const s = sources[i] as Lab;
      return [t[0] - s[0], t[1] - s[1], t[2] - s[2]];
    });
    expect([...applyShifts(input, labs, weights, shifts)]).toEqual([...recolour(input, sources, targets)]);
  });
});

describe('applyShifts', () => {
  it('applies a zero shift as the identity within 1 per channel and keeps alpha', () => {
    const input = rgba(randomPixels(20, 12), 99);
    const labs = labPixels(input);
    const weights = blendWeights(labs, [labOf(RED), labOf(BLUE)]);
    const out = applyShifts(input, labs, weights, [
      [0, 0, 0],
      [0, 0, 0],
    ]);
    expectWithin(out, input, 1);
  });

  it('applies a uniform lightness shift with a single swatch', () => {
    const px: Rgb = labToRgb([40, 0, 0]);
    const input = rgba([px]);
    const out = applyShifts(input, labPixels(input), Float64Array.from([1]), [[20, 0, 0]]);
    expect(labAt(out, 0)[0]).toBeCloseTo(rgbToLab(px)[0] + 20, 0);
  });
});
