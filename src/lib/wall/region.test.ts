import { describe, expect, it } from 'vitest';
import {
  MIN_SIDE,
  WHOLE,
  clampRegion,
  fromPercent,
  regionFromPoints,
  toPercent,
  toPixels,
  type Region,
} from './region';

const inside = (r: Region) => {
  const eps = 1e-9;
  expect(r.x).toBeGreaterThanOrEqual(0);
  expect(r.y).toBeGreaterThanOrEqual(0);
  expect(r.x + r.w).toBeLessThanOrEqual(1 + eps);
  expect(r.y + r.h).toBeLessThanOrEqual(1 + eps);
  expect(r.w).toBeGreaterThanOrEqual(MIN_SIDE - eps);
  expect(r.h).toBeGreaterThanOrEqual(MIN_SIDE - eps);
};

describe('constants', () => {
  it('has a minimum side of 5 percent', () => {
    expect(MIN_SIDE).toBe(0.05);
  });

  it('defines the whole image as the full unit square', () => {
    expect(WHOLE).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});

describe('clampRegion', () => {
  it('leaves an already valid region unchanged', () => {
    const r = { x: 0.1, y: 0.2, w: 0.5, h: 0.4 };
    expect(clampRegion(r)).toEqual(r);
  });

  it('leaves the whole image unchanged', () => {
    expect(clampRegion(WHOLE)).toEqual(WHOLE);
  });

  it('grows a too-narrow width to the minimum side', () => {
    const out = clampRegion({ x: 0.2, y: 0.2, w: 0.01, h: 0.3 });
    expect(out.w).toBeCloseTo(MIN_SIDE, 10);
    expect(out.h).toBe(0.3);
  });

  it('grows a too-short height to the minimum side', () => {
    const out = clampRegion({ x: 0.2, y: 0.2, w: 0.3, h: 0 });
    expect(out.h).toBeCloseTo(MIN_SIDE, 10);
    expect(out.w).toBe(0.3);
  });

  it('shrinks a width larger than 1 to 1', () => {
    const out = clampRegion({ x: 0, y: 0.1, w: 3, h: 0.5 });
    expect(out.w).toBe(1);
    expect(out.x).toBe(0);
  });

  it('shrinks a height larger than 1 to 1', () => {
    const out = clampRegion({ x: 0.1, y: 0, w: 0.5, h: 2 });
    expect(out.h).toBe(1);
    expect(out.y).toBe(0);
  });

  it('moves a negative x to 0', () => {
    expect(clampRegion({ x: -0.3, y: 0.1, w: 0.4, h: 0.4 }).x).toBe(0);
  });

  it('moves a negative y to 0', () => {
    expect(clampRegion({ x: 0.1, y: -0.3, w: 0.4, h: 0.4 }).y).toBe(0);
  });

  it('shifts x left, keeping the width, when the region overflows the right edge', () => {
    const out = clampRegion({ x: 0.9, y: 0.1, w: 0.3, h: 0.3 });
    expect(out.x).toBeCloseTo(0.7, 10);
    expect(out.w).toBe(0.3);
  });

  it('shifts y up, keeping the height, when the region overflows the bottom edge', () => {
    const out = clampRegion({ x: 0.1, y: 0.8, w: 0.3, h: 0.4 });
    expect(out.y).toBeCloseTo(0.6, 10);
    expect(out.h).toBe(0.4);
  });

  it('grows a tiny region at the bottom-right corner and keeps it inside', () => {
    const out = clampRegion({ x: 1, y: 1, w: 0, h: 0 });
    inside(out);
    expect(out.x + out.w).toBeCloseTo(1, 10);
    expect(out.y + out.h).toBeCloseTo(1, 10);
  });

  it('is idempotent', () => {
    const once = clampRegion({ x: 1.4, y: -2, w: 0.001, h: 7 });
    expect(clampRegion(once)).toEqual(once);
  });

  it('always yields a region inside the image for assorted inputs', () => {
    const vals = [-5, -0.5, 0, 0.02, 0.5, 0.97, 1, 1.5, 100];
    const pairs = vals.flatMap((a) => vals.map((b) => [a, b] as const));
    for (const [x, y] of pairs) {
      for (const [w, h] of pairs) inside(clampRegion({ x, y, w, h }));
    }
  });

  it.each([
    ['x', { x: Number.NaN, y: 0, w: 0.5, h: 0.5 }],
    ['y', { x: 0, y: Number.NaN, w: 0.5, h: 0.5 }],
    ['w', { x: 0, y: 0, w: Number.NaN, h: 0.5 }],
    ['h', { x: 0, y: 0, w: 0.5, h: Number.NaN }],
    ['x infinite', { x: Infinity, y: 0, w: 0.5, h: 0.5 }],
    ['w infinite', { x: 0, y: 0, w: -Infinity, h: 0.5 }],
  ])('rejects a non-finite %s', (_name, r) => {
    expect(() => clampRegion(r)).toThrow(RangeError);
  });
});

describe('regionFromPoints', () => {
  const expected = { x: 0.2, y: 0.3, w: 0.4, h: 0.3 };

  it.each([
    ['top-left to bottom-right', { x: 0.2, y: 0.3 }, { x: 0.6, y: 0.6 }],
    ['bottom-right to top-left', { x: 0.6, y: 0.6 }, { x: 0.2, y: 0.3 }],
    ['top-right to bottom-left', { x: 0.6, y: 0.3 }, { x: 0.2, y: 0.6 }],
    ['bottom-left to top-right', { x: 0.2, y: 0.6 }, { x: 0.6, y: 0.3 }],
  ])('builds the same region dragging %s', (_name, a, b) => {
    const r = regionFromPoints(a, b);
    expect(r.x).toBeCloseTo(expected.x, 10);
    expect(r.y).toBeCloseTo(expected.y, 10);
    expect(r.w).toBeCloseTo(expected.w, 10);
    expect(r.h).toBeCloseTo(expected.h, 10);
  });

  it('clamps points outside the image to the image edges', () => {
    const r = regionFromPoints({ x: -0.5, y: -0.2 }, { x: 1.7, y: 3 });
    expect(r).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('gives at least the minimum side for a zero-size drag in the middle', () => {
    const r = regionFromPoints({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 });
    inside(r);
    expect(r.w).toBeCloseTo(MIN_SIDE, 10);
    expect(r.h).toBeCloseTo(MIN_SIDE, 10);
  });

  it('keeps a zero-size drag at the bottom-right corner inside the image', () => {
    const r = regionFromPoints({ x: 1, y: 1 }, { x: 1, y: 1 });
    inside(r);
    expect(r.x + r.w).toBeCloseTo(1, 10);
    expect(r.y + r.h).toBeCloseTo(1, 10);
  });

  it('keeps a zero-size drag at the top-left corner inside the image', () => {
    const r = regionFromPoints({ x: 0, y: 0 }, { x: 0, y: 0 });
    inside(r);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it('grows a tiny drag to the minimum side', () => {
    const r = regionFromPoints({ x: 0.3, y: 0.3 }, { x: 0.31, y: 0.32 });
    inside(r);
  });
});

describe('toPixels', () => {
  it('converts a centred half region on 1600x1200', () => {
    expect(toPixels({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 1600, 1200)).toEqual({
      x: 400,
      y: 300,
      w: 800,
      h: 600,
    });
  });

  it('converts the whole image to the full pixel size', () => {
    expect(toPixels(WHOLE, 1600, 1200)).toEqual({ x: 0, y: 0, w: 1600, h: 1200 });
  });

  it('returns whole pixels for awkward fractions', () => {
    const p = toPixels({ x: 0.123, y: 0.456, w: 0.333, h: 0.222 }, 777, 531);
    for (const v of [p.x, p.y, p.w, p.h]) expect(Number.isInteger(v)).toBe(true);
  });

  it('gives at least 1 pixel on each side for a tiny region on a small image', () => {
    const p = toPixels({ x: 0.5, y: 0.5, w: 0.05, h: 0.05 }, 10, 10);
    expect(p.w).toBeGreaterThanOrEqual(1);
    expect(p.h).toBeGreaterThanOrEqual(1);
  });

  it('gives at least 1 pixel even when the region has zero size', () => {
    const p = toPixels({ x: 0.2, y: 0.2, w: 0, h: 0 }, 100, 100);
    expect(p.w).toBe(1);
    expect(p.h).toBe(1);
  });

  it('never extends past the image', () => {
    const p = toPixels({ x: 0.7, y: 0.7, w: 0.3, h: 0.3 }, 101, 99);
    expect(p.x + p.w).toBeLessThanOrEqual(101);
    expect(p.y + p.h).toBeLessThanOrEqual(99);
  });

  it('can reach the last pixel column and row', () => {
    const p = toPixels({ x: 0.95, y: 0.95, w: 0.05, h: 0.05 }, 100, 100);
    expect(p.x + p.w).toBe(100);
    expect(p.y + p.h).toBe(100);
    expect(p.w).toBeGreaterThanOrEqual(1);
  });

  it('keeps a region starting at the far edge inside a 1 pixel image', () => {
    const p = toPixels({ x: 1, y: 1, w: 0.05, h: 0.05 }, 1, 1);
    expect(p).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it.each([
    [0, 100],
    [100, 0],
    [-5, 100],
    [100, -5],
    [Number.NaN, 100],
    [100, Number.NaN],
  ])('rejects width %s, height %s', (w, h) => {
    expect(() => toPixels(WHOLE, w, h)).toThrow(RangeError);
  });
});

describe('toPercent', () => {
  it('converts a region to percentages', () => {
    expect(toPercent({ x: 0.25, y: 0.1, w: 0.5, h: 0.4 })).toEqual({
      left: 25,
      top: 10,
      width: 50,
      height: 40,
    });
  });

  it('converts the whole image to 0, 0, 100, 100', () => {
    expect(toPercent(WHOLE)).toEqual({ left: 0, top: 0, width: 100, height: 100 });
  });

  it('rounds to at most one decimal place', () => {
    const p = toPercent({ x: 1 / 3, y: 2 / 3, w: 0.123456, h: 0.0549 });
    expect(p.left).toBe(33.3);
    expect(p.top).toBe(66.7);
    expect(p.width).toBe(12.3);
    expect(p.height).toBe(5.5);
  });
});

describe('fromPercent', () => {
  it('converts percentages to a region', () => {
    const r = fromPercent({ left: 25, top: 10, width: 50, height: 40 });
    expect(r.x).toBeCloseTo(0.25, 10);
    expect(r.y).toBeCloseTo(0.1, 10);
    expect(r.w).toBeCloseTo(0.5, 10);
    expect(r.h).toBeCloseTo(0.4, 10);
  });

  it('clamps a zero width up to the minimum side instead of throwing', () => {
    const r = fromPercent({ left: 10, top: 10, width: 0, height: 20 });
    expect(r.w).toBeCloseTo(MIN_SIDE, 10);
  });

  it('clamps a left of 120 percent back inside the image', () => {
    const r = fromPercent({ left: 120, top: 0, width: 20, height: 20 });
    inside(r);
    expect(r.x + r.w).toBeCloseTo(1, 10);
  });

  it('clamps negative and oversized percentages', () => {
    const r = fromPercent({ left: -10, top: -10, width: 300, height: 500 });
    expect(r).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it.each([
    ['left', { left: Number.NaN, top: 0, width: 50, height: 50 }],
    ['top', { left: 0, top: Number.NaN, width: 50, height: 50 }],
    ['width', { left: 0, top: 0, width: Number.NaN, height: 50 }],
    ['height', { left: 0, top: 0, width: 50, height: Number.NaN }],
  ])('rejects NaN %s', (_name, p) => {
    expect(() => fromPercent(p)).toThrow(RangeError);
  });

  it('round-trips a valid region with one-decimal percentages', () => {
    const r = fromPercent({ left: 12.5, top: 33.3, width: 40.1, height: 25.9 });
    expect(fromPercent(toPercent(r))).toEqual(r);
    expect(toPercent(fromPercent(toPercent(r)))).toEqual(toPercent(r));
  });
});
