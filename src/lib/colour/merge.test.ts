import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { deltaE2000 } from './delta-e';
import { mergeClusters } from './merge';
import type { Lab } from './types';

type Cluster = { lab: Lab; count: number };

function deepFreeze(clusters: Cluster[]): Cluster[] {
  clusters.forEach((c) => {
    Object.freeze(c.lab);
    Object.freeze(c);
  });
  return Object.freeze(clusters) as Cluster[];
}

function weightedSum(clusters: readonly Cluster[]): [number, number, number] {
  const s: [number, number, number] = [0, 0, 0];
  for (const c of clusters) {
    s[0] += c.lab[0] * c.count;
    s[1] += c.lab[1] * c.count;
    s[2] += c.lab[2] * c.count;
  }
  return s;
}

const clusterArb = fc.record({
  lab: fc.tuple(
    fc.double({ min: 0, max: 100, noNaN: true }),
    fc.double({ min: -80, max: 80, noNaN: true }),
    fc.double({ min: -80, max: 80, noNaN: true }),
  ),
  count: fc.integer({ min: 1, max: 1000 }),
});

describe('mergeClusters', () => {
  it('returns an empty list for no clusters', () => {
    expect(mergeClusters([], 5)).toEqual([]);
  });

  it('returns a lone cluster unchanged', () => {
    expect(mergeClusters([{ lab: [50, 10, -10], count: 7 }], 5)).toEqual([{ lab: [50, 10, -10], count: 7 }]);
  });

  it('merges two close clusters into the count-weighted mean with summed counts', () => {
    const a: Cluster = { lab: [50, 0, 0], count: 3 };
    const b: Cluster = { lab: [51, 1, -1], count: 1 };
    expect(deltaE2000(a.lab, b.lab)).toBeLessThan(5);
    const out = mergeClusters([a, b], 5);
    expect(out).toHaveLength(1);
    expect(out[0]?.count).toBe(4);
    expect(out[0]?.lab[0]).toBeCloseTo((50 * 3 + 51) / 4, 9);
    expect(out[0]?.lab[1]).toBeCloseTo((0 * 3 + 1) / 4, 9);
    expect(out[0]?.lab[2]).toBeCloseTo((0 * 3 - 1) / 4, 9);
  });

  it('weights by count, not by position in the list', () => {
    const a: Cluster = { lab: [50, 0, 0], count: 1 };
    const b: Cluster = { lab: [52, 0, 0], count: 9 };
    const forward = mergeClusters([a, b], 10);
    const backward = mergeClusters([b, a], 10);
    expect(forward[0]?.lab[0]).toBeCloseTo(51.8, 9);
    expect(backward[0]?.lab[0]).toBeCloseTo(51.8, 9);
  });

  it('keeps clusters separate when they are clearly different', () => {
    const a: Cluster = { lab: [30, 40, 20], count: 5 };
    const b: Cluster = { lab: [80, -40, 30], count: 2 };
    expect(deltaE2000(a.lab, b.lab)).toBeGreaterThan(5);
    const out = mergeClusters([a, b], 5);
    expect(out).toHaveLength(2);
    expect(out).toContainEqual(a);
    expect(out).toContainEqual(b);
  });

  it('keeps clusters separate when deltaE is exactly the threshold (strictly-less merge)', () => {
    const a: Cluster = { lab: [50, 0, 0], count: 2 };
    const b: Cluster = { lab: [60, 0, 0], count: 3 };
    const d = deltaE2000(a.lab, b.lab);
    expect(deltaE2000(b.lab, a.lab)).toBe(d);
    expect(mergeClusters([a, b], d)).toHaveLength(2);
  });

  it('merges when the threshold is just above the deltaE', () => {
    const a: Cluster = { lab: [50, 0, 0], count: 2 };
    const b: Cluster = { lab: [60, 0, 0], count: 3 };
    const d = deltaE2000(a.lab, b.lab);
    expect(mergeClusters([a, b], d + 1e-9)).toHaveLength(1);
  });

  it('keeps clusters separate when the threshold is just below the deltaE', () => {
    const a: Cluster = { lab: [50, 0, 0], count: 2 };
    const b: Cluster = { lab: [60, 0, 0], count: 3 };
    const d = deltaE2000(a.lab, b.lab);
    expect(mergeClusters([a, b], d - 1e-9)).toHaveLength(2);
  });

  it('does not merge identical clusters at threshold 0 but does at any positive threshold', () => {
    const a: Cluster = { lab: [50, 10, 10], count: 1 };
    const b: Cluster = { lab: [50, 10, 10], count: 1 };
    expect(mergeClusters([a, b], 0)).toHaveLength(2);
    expect(mergeClusters([a, b], 1e-9)).toHaveLength(1);
  });

  it('collapses everything into one cluster with the overall weighted mean when the threshold is huge', () => {
    const input: Cluster[] = [
      { lab: [20, 30, 10], count: 4 },
      { lab: [60, -20, 40], count: 1 },
      { lab: [90, 5, -50], count: 5 },
    ];
    const out = mergeClusters(input, 1000);
    expect(out).toHaveLength(1);
    expect(out[0]?.count).toBe(10);
    const expected = weightedSum(input).map((v) => v / 10);
    expect(out[0]?.lab[0]).toBeCloseTo(expected[0] ?? Number.NaN, 9);
    expect(out[0]?.lab[1]).toBeCloseTo(expected[1] ?? Number.NaN, 9);
    expect(out[0]?.lab[2]).toBeCloseTo(expected[2] ?? Number.NaN, 9);
  });

  it('merges a chain repeatedly: three near neighbours become one', () => {
    const input: Cluster[] = [
      { lab: [50, 0, 0], count: 1 },
      { lab: [52, 0, 0], count: 1 },
      { lab: [54, 0, 0], count: 1 },
    ];
    expect(deltaE2000(input[0]?.lab ?? [0, 0, 0], input[1]?.lab ?? [0, 0, 0])).toBeLessThan(5);
    const out = mergeClusters(input, 5);
    expect(out).toHaveLength(1);
    expect(out[0]?.count).toBe(3);
    expect(out[0]?.lab[0]).toBeCloseTo(52, 9);
  });

  it('merges only the near pair and leaves a distant cluster alone', () => {
    const far: Cluster = { lab: [90, 50, 50], count: 4 };
    const out = mergeClusters([{ lab: [30, 0, 0], count: 1 }, far, { lab: [31, 0, 0], count: 1 }], 5);
    expect(out).toHaveLength(2);
    expect(out).toContainEqual(far);
    expect(out.some((c) => c.count === 2)).toBe(true);
  });

  it('does not mutate its input', () => {
    const input = deepFreeze([
      { lab: [50, 0, 0], count: 3 },
      { lab: [51, 0, 0], count: 1 },
      { lab: [90, 40, 40], count: 2 },
    ]);
    const snapshot = JSON.stringify(input);
    expect(() => mergeClusters(input, 5)).not.toThrow();
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('property: counts are preserved and the weighted centre of mass is unchanged', () => {
    fc.assert(
      fc.property(
        fc.array(clusterArb, { minLength: 0, maxLength: 12 }),
        fc.double({ min: 0, max: 40, noNaN: true }),
        (input, t) => {
          const out = mergeClusters(input, t);
          expect(out.reduce((s, c) => s + c.count, 0)).toBe(input.reduce((s, c) => s + c.count, 0));
          expect(out.length).toBeLessThanOrEqual(input.length);
          const before = weightedSum(input);
          const after = weightedSum(out);
          for (let i = 0; i < 3; i++) {
            expect(after[i]).toBeCloseTo(before[i] ?? Number.NaN, 5);
          }
        },
      ),
      { seed: 42, numRuns: 300 },
    );
  });

  it('property: no remaining pair is closer than the threshold', () => {
    fc.assert(
      fc.property(
        fc.array(clusterArb, { minLength: 0, maxLength: 12 }),
        fc.double({ min: 0, max: 40, noNaN: true }),
        (input, t) => {
          const out = mergeClusters(input, t);
          for (let i = 0; i < out.length; i++) {
            for (let j = i + 1; j < out.length; j++) {
              const d = deltaE2000(out[i]?.lab ?? [0, 0, 0], out[j]?.lab ?? [0, 0, 0]);
              expect(d).toBeGreaterThanOrEqual(t);
            }
          }
        },
      ),
      { seed: 42, numRuns: 300 },
    );
  });

  it('property: nothing is merged when the threshold is 0 and all clusters differ', () => {
    fc.assert(
      fc.property(fc.array(clusterArb, { minLength: 0, maxLength: 8 }), (input) => {
        const unique = input.filter((c, i) => input.findIndex((o) => o.lab.join() === c.lab.join()) === i);
        expect(mergeClusters(unique, 0)).toHaveLength(unique.length);
      }),
      { seed: 42, numRuns: 100 },
    );
  });
});
