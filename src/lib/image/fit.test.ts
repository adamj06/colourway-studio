import { describe, expect, it } from 'vitest';
import { fitWithin } from './fit';

describe('fitWithin', () => {
  it('scales a landscape image so its width is the max side', () => {
    expect(fitWithin(1600, 1200, 600)).toEqual({ width: 600, height: 450 });
  });

  it('scales a portrait image so its height is the max side', () => {
    expect(fitWithin(1200, 1600, 600)).toEqual({ width: 450, height: 600 });
  });

  it('never scales up', () => {
    expect(fitWithin(300, 200, 600)).toEqual({ width: 300, height: 200 });
  });

  it('leaves an image exactly at the max side alone', () => {
    expect(fitWithin(600, 600, 600)).toEqual({ width: 600, height: 600 });
  });

  it('rounds to whole pixels', () => {
    expect(fitWithin(1000, 333, 600)).toEqual({ width: 600, height: 200 });
  });

  it('keeps a very thin image at least 1 pixel on the short side', () => {
    expect(fitWithin(10_000, 1, 600)).toEqual({ width: 600, height: 1 });
  });

  it.each([
    [0, 10, 600],
    [10, 0, 600],
    [-1, 10, 600],
    [Number.NaN, 10, 600],
    [10, 10, 0],
    [10, 10, 0.5],
    [10, 10, Number.NaN],
  ])('rejects width %s, height %s, maxSide %s', (width, height, maxSide) => {
    expect(() => fitWithin(width, height, maxSide)).toThrow(RangeError);
  });
});
