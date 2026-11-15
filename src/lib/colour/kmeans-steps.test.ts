import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { kmeansLab, kmeansLabSteps, type KmeansOptions, type KmeansResult } from './kmeans';
import { mulberry32 } from './prng';

/** Deterministic noisy Lab-like points (test input only). */
function noisy(n: number, seed = 3): Float64Array {
  const rng = mulberry32(seed);
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = rng() * 100;
    out[i * 3 + 1] = rng() * 100 - 50;
    out[i * 3 + 2] = rng() * 100 - 50;
  }
  return out;
}

/** Runs the generator to completion, counting yields. */
function drain(gen: Generator<void, KmeansResult | null, void>): { value: KmeansResult | null; yields: number } {
  let yields = 0;
  for (;;) {
    const step = gen.next();
    if (step.done === true) return { value: step.value, yields };
    yields++;
  }
}

function run(samples: Float64Array, k: number, options?: KmeansOptions, seed = 1) {
  return drain(kmeansLabSteps(samples, k, mulberry32(seed), options));
}

describe('kmeansLabSteps: yield counts', () => {
  it('yields exactly iterations minus one times for a converging noisy dataset', () => {
    const { value, yields } = run(noisy(300), 5);
    expect(value).not.toBeNull();
    expect(value?.iterations).toBeGreaterThan(1);
    expect(yields).toBe((value?.iterations ?? 0) - 1);
  });

  it('yields no times when capped at one iteration', () => {
    const { value, yields } = run(noisy(300), 5, { maxIterations: 1 });
    expect(value?.iterations).toBe(1);
    expect(yields).toBe(0);
  });

  it('yields iterations minus one times when capped at three iterations', () => {
    const { value, yields } = run(noisy(500, 9), 8, { maxIterations: 3 });
    expect(value?.iterations).toBeLessThanOrEqual(3);
    expect(yields).toBe((value?.iterations ?? 0) - 1);
  });

  it('runs all three iterations of a capped run on data that does not converge that fast', () => {
    const { value, yields } = run(noisy(500, 9), 8, { maxIterations: 3 });
    expect(value?.iterations).toBe(3);
    expect(yields).toBe(2);
  });

  it('yields no times for empty input and returns the empty result', () => {
    const { value, yields } = run(new Float64Array(0), 4);
    expect(yields).toBe(0);
    expect(value).toEqual({ centroids: new Float64Array(0), counts: [], iterations: 0 });
  });

  it('yields iterations minus one times when k is 1', () => {
    const { value, yields } = run(noisy(100), 1);
    expect(value?.counts).toEqual([100]);
    expect(yields).toBe((value?.iterations ?? 0) - 1);
  });
});

describe('kmeansLabSteps: same result as kmeansLab', () => {
  it('matches kmeansLab on a noisy dataset', () => {
    const samples = noisy(400, 5);
    expect(run(samples, 6, undefined, 7).value).toEqual(kmeansLab(samples, 6, mulberry32(7)));
  });

  it('matches kmeansLab for any small random Lab dataset, k and seed', () => {
    const point = fc.tuple(
      fc.double({ min: 0, max: 100, noNaN: true }),
      fc.double({ min: -100, max: 100, noNaN: true }),
      fc.double({ min: -100, max: 100, noNaN: true }),
    );
    fc.assert(
      fc.property(
        fc.array(point, { minLength: 0, maxLength: 40 }),
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 0, max: 1000 }),
        (points, k, seed) => {
          const samples = Float64Array.from(points.flat());
          const stepped = run(samples, k, undefined, seed);
          const direct = kmeansLab(samples, k, mulberry32(seed));
          expect(stepped.value).toEqual(direct);
          expect(stepped.yields).toBe(Math.max(0, (direct?.iterations ?? 0) - 1));
        },
      ),
      { seed: 42, numRuns: 100 },
    );
  });

  it('does not mutate the input samples', () => {
    const samples = noisy(200);
    const copy = samples.slice();
    run(samples, 5);
    expect(samples).toEqual(copy);
  });
});

describe('kmeansLabSteps: shouldStop', () => {
  it('is called once before every iteration, including after each resume, when it never returns true', () => {
    let calls = 0;
    const { value } = run(noisy(300), 5, {
      shouldStop: () => {
        calls++;
        return false;
      },
    });
    expect(value?.iterations).toBeGreaterThan(1);
    expect(calls).toBe(value?.iterations);
  });

  it('is not called until the first next()', () => {
    let calls = 0;
    const gen = kmeansLabSteps(noisy(100), 3, mulberry32(1), {
      shouldStop: () => {
        calls++;
        return false;
      },
    });
    expect(calls).toBe(0);
    gen.next();
    expect(calls).toBe(1);
  });

  it('returns null at once when shouldStop is already true', () => {
    const gen = kmeansLabSteps(noisy(100), 3, mulberry32(1), { shouldStop: () => true });
    expect(gen.next()).toEqual({ done: true, value: null });
  });

  it('returns null on the next call, with no further yields, when shouldStop flips after the first yield', () => {
    let stop = false;
    const gen = kmeansLabSteps(noisy(300), 5, mulberry32(1), { shouldStop: () => stop });
    const first = gen.next();
    expect(first.done).toBe(false);
    stop = true;
    expect(gen.next()).toEqual({ done: true, value: null });
    expect(gen.next()).toEqual({ done: true, value: undefined });
  });
});
