import { describe, expect, it } from 'vitest';

import { buildImage, solidImage } from '../../../tests/helpers/colour';
import { labToRgb, rgbToLab } from './convert';
import { MAX_SAMPLES, sampleLabPixels } from './sample';
import type { Rgb } from './types';

function triples(samples: Float64Array): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < samples.length; i += 3) {
    out.push([samples[i] ?? Number.NaN, samples[i + 1] ?? Number.NaN, samples[i + 2] ?? Number.NaN]);
  }
  return out;
}

/** Image where pixel i has red channel i (0..255), so sampled pixels can be identified from their Lab. */
function rampImage(count: number) {
  return buildImage(count, 1, (x) => ({ rgb: [x, 0, 0] as Rgb }));
}

describe('sampleLabPixels', () => {
  it('caps the default budget at 40,000 samples', () => {
    expect(MAX_SAMPLES).toBe(40_000);
  });

  it('converts a single opaque pixel to one Lab triple', () => {
    const out = sampleLabPixels(solidImage(1, 1, [200, 100, 50]));
    expect(out).toBeInstanceOf(Float64Array);
    expect(out).toHaveLength(3);
    const expected = rgbToLab([200, 100, 50]);
    expect(out[0]).toBeCloseTo(expected[0], 9);
    expect(out[1]).toBeCloseTo(expected[1], 9);
    expect(out[2]).toBeCloseTo(expected[2], 9);
  });

  it('returns an empty array for an empty image', () => {
    expect(sampleLabPixels({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toHaveLength(0);
  });

  it('returns an empty array when every pixel is fully transparent', () => {
    expect(sampleLabPixels(solidImage(8, 8, [10, 20, 30], 0))).toHaveLength(0);
  });

  it('skips pixels with alpha 127', () => {
    expect(sampleLabPixels(solidImage(4, 4, [10, 20, 30], 127))).toHaveLength(0);
  });

  it('keeps pixels with alpha 128', () => {
    expect(sampleLabPixels(solidImage(4, 4, [10, 20, 30], 128))).toHaveLength(4 * 4 * 3);
  });

  it('keeps pixels with alpha 255', () => {
    expect(sampleLabPixels(solidImage(2, 2, [10, 20, 30], 255))).toHaveLength(12);
  });

  it('skips alpha 1 and keeps alpha 200', () => {
    expect(sampleLabPixels(solidImage(2, 2, [10, 20, 30], 1))).toHaveLength(0);
    expect(sampleLabPixels(solidImage(2, 2, [10, 20, 30], 200))).toHaveLength(12);
  });

  it('keeps only the opaque pixels of a mixed image, in order', () => {
    const alphas = [255, 0, 128, 127, 255];
    const image = buildImage(5, 1, (x) => ({ rgb: [x * 10, 0, 0] as Rgb, alpha: alphas[x] ?? 0 }));
    const kept = triples(sampleLabPixels(image)).map((lab) => labToRgb(lab)[0]);
    expect(kept).toEqual([0, 20, 40]);
  });

  it('reads each pixel from its own RGBA offset, ignoring alpha as a colour', () => {
    const image = buildImage(3, 1, (x) => ({
      rgb: (
        [
          [255, 0, 0],
          [0, 255, 0],
          [0, 0, 255],
        ] as Rgb[]
      )[x] ?? [0, 0, 0],
    }));
    const out = triples(sampleLabPixels(image));
    expect(out).toHaveLength(3);
    const colours: Rgb[] = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
    ];
    colours.forEach((rgb, i) => {
      const expected = rgbToLab(rgb);
      expect(out[i]?.[0]).toBeCloseTo(expected[0], 9);
      expect(out[i]?.[1]).toBeCloseTo(expected[1], 9);
      expect(out[i]?.[2]).toBeCloseTo(expected[2], 9);
    });
  });

  it('keeps every pixel when the count is at or below maxSamples', () => {
    expect(sampleLabPixels(rampImage(100), 100)).toHaveLength(300);
    expect(sampleLabPixels(rampImage(100), 101)).toHaveLength(300);
    expect(sampleLabPixels(rampImage(100), 1000)).toHaveLength(300);
  });

  it('stays within maxSamples when the image is just one pixel over', () => {
    const out = sampleLabPixels(rampImage(101), 100);
    expect(out.length % 3).toBe(0);
    expect(out.length / 3).toBeLessThanOrEqual(100);
    expect(out.length / 3).toBeGreaterThanOrEqual(50);
  });

  it('subsamples a 1,000,000-pixel image to at most 40,000 samples by default', () => {
    const out = sampleLabPixels(solidImage(1000, 1000, [90, 120, 200]));
    expect(out.length % 3).toBe(0);
    expect(out.length / 3).toBeLessThanOrEqual(40_000);
    expect(out.length / 3).toBeGreaterThanOrEqual(20_000);
  });

  it('honours a custom maxSamples', () => {
    const out = sampleLabPixels(rampImage(200), 10);
    expect(out.length / 3).toBeLessThanOrEqual(10);
    expect(out.length / 3).toBeGreaterThanOrEqual(5);
  });

  it('returns a single sample when maxSamples is 1', () => {
    expect(sampleLabPixels(rampImage(100), 1)).toHaveLength(3);
  });

  it('preserves pixel order and spreads samples over the whole image', () => {
    const out = triples(sampleLabPixels(rampImage(240), 20)).map((lab) => labToRgb(lab)[0]);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]).toBeGreaterThan(out[i - 1] ?? Number.POSITIVE_INFINITY);
    }
    expect(Math.max(...out)).toBeGreaterThan(240 * 0.7);
    expect(Math.min(...out)).toBeLessThan(240 * 0.3);
  });

  it('samples at an even stride', () => {
    const out = triples(sampleLabPixels(rampImage(240), 20)).map((lab) => labToRgb(lab)[0]);
    const gaps = out.slice(1).map((v, i) => v - (out[i] ?? 0));
    expect(new Set(gaps).size).toBe(1);
  });

  it('is deterministic: the same input gives identical output', () => {
    const image = rampImage(200);
    expect(sampleLabPixels(image, 17)).toEqual(sampleLabPixels(image, 17));
  });

  it('does not modify the pixel buffer', () => {
    const image = rampImage(50);
    const copy = new Uint8ClampedArray(image.data);
    sampleLabPixels(image, 5);
    expect(image.data).toEqual(copy);
  });

  it('does not let transparent pixels use up the sample budget', () => {
    const alphas = (x: number) => (x < 50 ? 0 : 255);
    const image = buildImage(100, 1, (x) => ({ rgb: [x, 0, 0] as Rgb, alpha: alphas(x) }));
    expect(sampleLabPixels(image, 100)).toHaveLength(50 * 3);
  });
});
