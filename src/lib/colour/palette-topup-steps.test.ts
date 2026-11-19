// extractPaletteSteps must yield once per k-means iteration across every top-up run, and shouldStop must abandon the
// whole thing (result null) wherever it fires, including during a later top-up run.

import { describe, expect, it } from 'vitest';

import { kmeansLab } from './kmeans';
import { mergeClusters, type Cluster } from './merge';
import { DEFAULT_SEED, extractPaletteFromSamples, extractPaletteSteps, MERGE_DELTA_E } from './palette';
import { mulberry32 } from './prng';
import type { Lab, Swatch } from './types';

const DISTINCT: Lab[] = [
  [30, 60, 40],
  [50, -60, 40],
  [80, 0, 80],
  [30, 40, -60],
  [60, 0, -50],
  [92, 0, 0],
  [10, 0, 0],
  [55, 60, -10],
];
const SHADES: Lab[] = Array.from({ length: 10 }, (_, i): Lab => [44 + i, 50, 30]);

function buildSamples(spec: readonly (readonly [Lab, number])[]): Float64Array {
  const total = spec.reduce((sum, [, count]) => sum + count, 0);
  const out = new Float64Array(total * 3);
  let i = 0;
  for (const [lab, count] of spec) {
    for (let n = 0; n < count; n++) {
      out.set(lab, i * 3);
      i++;
    }
  }
  return out;
}

/** With seed 1, k=4 merges down to 3 (so a run at 5 is needed) and k=8 merges down to 7. */
function samples(): Float64Array {
  return buildSamples([...SHADES.map((l) => [l, 1000] as const), ...DISTINCT.map((l) => [l, 10] as const)]);
}

function drain(gen: Generator<void, Swatch[] | null, void>): { value: Swatch[] | null; yields: number } {
  let yields = 0;
  for (;;) {
    const step = gen.next();
    if (step.done === true) return { value: step.value, yields };
    yields++;
  }
}

function runInfo(s: Float64Array, runK: number, seed: number): { iterations: number; merged: number } {
  const result = kmeansLab(s, runK, mulberry32(seed));
  if (result === null) throw new Error('unreachable');
  const clusters: Cluster[] = result.counts.map((count, c) => ({
    lab: [result.centroids[c * 3] ?? 0, result.centroids[c * 3 + 1] ?? 0, result.centroids[c * 3 + 2] ?? 0],
    count,
  }));
  return { iterations: result.iterations, merged: mergeClusters(clusters, MERGE_DELTA_E).length };
}

describe('extractPaletteSteps with top-up runs', () => {
  it('fixture: k=4 needs a second run (4 merges below 4, 5 reaches 5) and k=5 does not', () => {
    const s = samples();
    expect(runInfo(s, 4, DEFAULT_SEED).merged).toBeLessThan(4);
    expect(runInfo(s, 5, DEFAULT_SEED).merged).toBeGreaterThanOrEqual(5);
  });

  it('yields once per k-means iteration of every top-up run (k=4: a run at 4, then a run at 5)', () => {
    const s = samples();
    const first = runInfo(s, 4, DEFAULT_SEED);
    const second = runInfo(s, 5, DEFAULT_SEED);
    expect(first.iterations).toBeGreaterThan(1);
    expect(second.iterations).toBeGreaterThan(1);
    // kmeansLabSteps yields (iterations - 1) times per run.
    const expected = first.iterations - 1 + (second.iterations - 1);
    expect(drain(extractPaletteSteps(s, { k: 4 })).yields).toBe(expected);
  });

  it('yields more than a single run would when a top-up is needed', () => {
    const s = samples();
    const single = runInfo(s, 4, DEFAULT_SEED).iterations - 1;
    expect(drain(extractPaletteSteps(s, { k: 4 })).yields).toBeGreaterThan(single);
  });

  it('yields exactly the single-run count when the first run already gives k swatches (k=5)', () => {
    const s = samples();
    expect(drain(extractPaletteSteps(s, { k: 5 })).yields).toBe(runInfo(s, 5, DEFAULT_SEED).iterations - 1);
  });

  it('gives the same palette as extractPaletteFromSamples, with exactly k swatches', () => {
    const s = samples();
    for (const k of [4, 5, 8]) {
      const { value } = drain(extractPaletteSteps(s, { k }));
      expect(value).toHaveLength(k);
      expect(value).toEqual(extractPaletteFromSamples(s, { k }));
    }
  });

  it('respects a custom seed across top-up runs', () => {
    const s = samples();
    const { value } = drain(extractPaletteSteps(s, { k: 4, seed: 99 }));
    expect(value).toEqual(extractPaletteFromSamples(s, { k: 4, seed: 99 }));
    expect(value).toHaveLength(4);
  });
});

describe('extractPaletteSteps with top-up runs: shouldStop', () => {
  it('returns null when shouldStop fires during a later top-up run (after the first run finished)', () => {
    const s = samples();
    const firstRunYields = runInfo(s, 4, DEFAULT_SEED).iterations - 1;
    let yielded = 0;
    const gen = extractPaletteSteps(s, { k: 4, shouldStop: () => yielded > firstRunYields });
    for (;;) {
      const step = gen.next();
      if (step.done === true) {
        expect(step.value).toBeNull();
        break;
      }
      yielded++;
      // Never ran past the first yield of the second run before being stopped.
      expect(yielded).toBeLessThanOrEqual(firstRunYields + 2);
    }
    expect(yielded).toBeGreaterThan(firstRunYields);
  });

  it('returns null at once when shouldStop is already true', () => {
    expect(extractPaletteSteps(samples(), { k: 4, shouldStop: () => true }).next()).toEqual({
      done: true,
      value: null,
    });
  });

  it('returns null from extractPaletteFromSamples when shouldStop fires only during a later run', () => {
    const s = samples();
    const firstRunYields = runInfo(s, 4, DEFAULT_SEED).iterations - 1;
    // shouldStop is called once per iteration; the first run makes firstRunYields + 1 calls.
    let calls = 0;
    expect(extractPaletteFromSamples(s, { k: 4, shouldStop: () => ++calls > firstRunYields + 1 })).toBeNull();
  });

  it('completes with a palette when shouldStop stays false throughout all runs', () => {
    expect(drain(extractPaletteSteps(samples(), { k: 4, shouldStop: () => false })).value).toHaveLength(4);
  });
});
