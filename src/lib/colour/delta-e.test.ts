import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { loadRawSharmaText, loadSharmaPairs } from '../../../tests/helpers/colour';
import { deltaE2000 } from './delta-e';

const PROP = { seed: 42, numRuns: 200 } as const;
const labArb = fc.tuple(
  fc.double({ min: 0, max: 100, noNaN: true }),
  fc.double({ min: -128, max: 128, noNaN: true }),
  fc.double({ min: -128, max: 128, noNaN: true }),
);

describe('deltaE2000 against Sharma, Wu and Dalal (2005)', () => {
  const pairs = loadSharmaPairs();

  it('has all 34 published pairs', () => {
    expect(pairs).toHaveLength(34);
  });

  it('keeps the JSON fixture identical to the raw published text file', () => {
    const rows = loadRawSharmaText()
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.split('\t').map((cell) => Number(cell)));
    expect(rows).toHaveLength(34);
    for (const row of rows) {
      expect(row).toHaveLength(7);
    }
    const parsed = rows.map((r) => ({
      lab1: [r[0], r[1], r[2]],
      lab2: [r[3], r[4], r[5]],
      deltaE: r[6],
    }));
    const fromJson = pairs.map((p) => ({ lab1: p.lab1, lab2: p.lab2, deltaE: p.deltaE }));
    expect(fromJson).toEqual(parsed);
  });

  it.each(pairs.map((p) => [p.pair, p] as const))(
    'matches the published value to 4 decimals for pair %i (both argument orders)',
    (_n, p) => {
      expect(deltaE2000(p.lab1, p.lab2)).toBeCloseTo(p.deltaE, 4);
      expect(deltaE2000(p.lab2, p.lab1)).toBeCloseTo(p.deltaE, 4);
    },
  );
});

describe('deltaE2000 properties', () => {
  it('is exactly 0 for identical colours', () => {
    fc.assert(
      fc.property(labArb, (lab) => {
        expect(deltaE2000(lab, lab)).toBe(0);
      }),
      PROP,
    );
  });

  it('is symmetric', () => {
    fc.assert(
      fc.property(labArb, labArb, (a, b) => {
        expect(deltaE2000(a, b)).toBeCloseTo(deltaE2000(b, a), 9);
      }),
      { seed: 42, numRuns: 500 },
    );
  });

  it('is finite and non-negative', () => {
    fc.assert(
      fc.property(labArb, labArb, (a, b) => {
        const d = deltaE2000(a, b);
        expect(Number.isFinite(d)).toBe(true);
        expect(d).toBeGreaterThanOrEqual(0);
      }),
      { seed: 42, numRuns: 500 },
    );
  });

  it('is positive for clearly different colours', () => {
    expect(deltaE2000([50, 0, 0], [60, 0, 0])).toBeGreaterThan(0);
    expect(deltaE2000([50, 10, 0], [50, -10, 0])).toBeGreaterThan(0);
    expect(deltaE2000([50, 0, 10], [50, 0, -10])).toBeGreaterThan(0);
  });

  it('accepts frozen inputs without trying to mutate them', () => {
    const a = Object.freeze([50, 10, 10] as const);
    const b = Object.freeze([55, -5, 20] as const);
    expect(deltaE2000(a, b)).toBeGreaterThan(0);
  });

  it('increases as lightness difference grows on the neutral axis', () => {
    const d1 = deltaE2000([50, 0, 0], [52, 0, 0]);
    const d2 = deltaE2000([50, 0, 0], [58, 0, 0]);
    expect(d2).toBeGreaterThan(d1);
  });
});
