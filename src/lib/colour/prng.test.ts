import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { mulberry32 } from './prng';

function draw(seed: number, n: number): number[] {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, () => rng());
}

describe('mulberry32', () => {
  it('produces the same sequence for the same seed', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
        expect(draw(seed, 20)).toEqual(draw(seed, 20));
      }),
      { seed: 42, numRuns: 100 },
    );
  });

  it('produces different sequences for different seeds', () => {
    expect(draw(1, 10)).not.toEqual(draw(2, 10));
    expect(draw(0, 10)).not.toEqual(draw(1, 10));
  });

  it('gives mostly distinct first values across seeds', () => {
    const firsts = new Set(Array.from({ length: 50 }, (_, i) => draw(i, 1)[0]));
    expect(firsts.size).toBeGreaterThanOrEqual(49);
  });

  it('does not repeat the same value forever', () => {
    expect(new Set(draw(7, 100)).size).toBeGreaterThan(95);
  });

  it('keeps every draw in [0, 1) for any seed', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
        for (const v of draw(seed, 200)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(1);
        }
      }),
      { seed: 42, numRuns: 100 },
    );
  });

  it('keeps 10,000 draws in [0, 1)', () => {
    const values = draw(12345, 10_000);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
  });

  it('spreads 10,000 draws roughly evenly over four bins', () => {
    const values = draw(2026, 10_000);
    const bins = [0, 0, 0, 0];
    for (const v of values) {
      const i = Math.floor(v * 4);
      bins[i] = (bins[i] ?? 0) + 1;
    }
    for (const count of bins) {
      expect(count / values.length).toBeGreaterThan(0.2);
      expect(count / values.length).toBeLessThan(0.3);
    }
  });

  it('has a mean close to 0.5', () => {
    const values = draw(99, 10_000);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.02);
  });

  it('keeps generators independent when interleaved', () => {
    const a = mulberry32(5);
    const b = mulberry32(5);
    const first = [a(), a(), a()];
    b();
    b();
    b();
    expect(draw(5, 3)).toEqual(first);
    expect(b()).toBe(draw(5, 4)[3]);
  });
});
