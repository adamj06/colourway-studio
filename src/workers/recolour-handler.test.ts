import { describe, expect, it } from 'vitest';

import { hexToRgb, rgbToLab } from '../lib/colour/convert';
import { deltaE2000 } from '../lib/colour/delta-e';
import { mulberry32 } from '../lib/colour/prng';
import { recolour } from '../lib/colour/recolour';
import type { Lab } from '../lib/colour/types';
import { createRecolourHandler } from './recolour-handler';
import type { RecolourResponse } from './recolour-protocol';

const labOf = (hex: string): Lab => rgbToLab(hexToRgb(hex));
const SOURCES = ['#C0392B', '#2E86C1', '#27AE60', '#F1C40F'].map(labOf);
const TARGETS_A = ['#2ECC71', '#E67E22', '#8E44AD', '#1ABC9C'].map(labOf);
const TARGETS_B = ['#000000', '#FFFFFF', '#808080', '#FF00FF'].map(labOf);

function pixels(seed = 1, width = 8, height = 6): Uint8ClampedArray {
  const rng = mulberry32(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i++) data[i] = i % 4 === 3 ? 255 - (i % 7) : Math.floor(rng() * 256);
  return data;
}

/**
 * The handler recolours through a lookup table, so output is not byte-identical to the direct recolour(). The
 * tolerance for these small, smooth test images is deltaE2000 < 1 (the dense-sweep bound of 2.5 is in the LUT tests).
 */
function expectCloseToDirect(actual: Uint8ClampedArray, expected: Uint8ClampedArray): void {
  expect(actual).toHaveLength(expected.length);
  for (let p = 0; p < expected.length / 4; p++) {
    const rgb = (d: Uint8ClampedArray) => [d[p * 4] ?? -1, d[p * 4 + 1] ?? -1, d[p * 4 + 2] ?? -1] as const;
    expect(deltaE2000(rgbToLab(rgb(actual)), rgbToLab(rgb(expected)))).toBeLessThan(1);
    expect(actual[p * 4 + 3]).toBe(expected[p * 4 + 3]);
  }
}

const lab3 = (l: readonly Lab[]) => l.map((v) => [...v]);

function prepareRequest(id: number, data = pixels(), sources: readonly Lab[] = SOURCES, width = 8, height = 6) {
  return { type: 'prepare', id, image: { width, height, data }, sources: lab3(sources) };
}

function recolourRequest(id: number, targets: readonly Lab[] = TARGETS_A) {
  return { type: 'recolour', id, targets: lab3(targets) };
}

function recorder() {
  const posted: RecolourResponse[] = [];
  return {
    posted,
    post: (response: RecolourResponse): void => {
      posted.push(response);
    },
  };
}

const immediate = () => ({ yieldTick: () => Promise.resolve() });

/** A yieldTick that resolves at once until arm() is called, then holds every tick until release(). */
function armedTick() {
  const pending: (() => void)[] = [];
  let armed = false;
  let open = false;
  return {
    yieldTick: (): Promise<void> => {
      if (!armed || open) return Promise.resolve();
      return new Promise<void>((resolve) => {
        pending.push(resolve);
      });
    },
    arm: (): void => {
      armed = true;
    },
    release: (): void => {
      open = true;
      pending.splice(0).forEach((resolve) => {
        resolve();
      });
    },
  };
}

function flushMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function imagesWithId(posted: readonly RecolourResponse[], id: number) {
  return posted.flatMap((r) => (r.type === 'image' && r.id === id ? [r] : []));
}

function imageOf(posted: readonly RecolourResponse[], id: number) {
  const found = imagesWithId(posted, id);
  expect(found).toHaveLength(1);
  return found[0]!;
}

function errorsWithId(posted: readonly RecolourResponse[], id: number | null) {
  return posted.flatMap((r) => (r.type === 'error' && r.id === id ? [r] : []));
}

describe('recolour handler: recolour', () => {
  it('posts one image for a recolour request, with the id and the image size', async () => {
    const { posted, post } = recorder();
    const handler = createRecolourHandler(immediate());
    await handler.handle(prepareRequest(1), post);
    await handler.handle(recolourRequest(2), post);
    const image = imageOf(posted, 2);
    expect(image.width).toBe(8);
    expect(image.height).toBe(6);
    expect(image.data).toBeInstanceOf(Uint8ClampedArray);
    expect(image.data).toHaveLength(8 * 6 * 4);
  });

  it('produces exactly what the recolour library function produces', async () => {
    const data = pixels(3);
    const { posted, post } = recorder();
    const handler = createRecolourHandler(immediate());
    await handler.handle(prepareRequest(1, data), post);
    await handler.handle(recolourRequest(2, TARGETS_A), post);
    expectCloseToDirect(imageOf(posted, 2).data, recolour(data, SOURCES, TARGETS_A));
  });

  it('answers repeated recolour requests from the one prepared image', async () => {
    const data = pixels(4);
    const { posted, post } = recorder();
    const handler = createRecolourHandler(immediate());
    await handler.handle(prepareRequest(1, data), post);
    await handler.handle(recolourRequest(2, TARGETS_A), post);
    await handler.handle(recolourRequest(3, TARGETS_B), post);
    await handler.handle(recolourRequest(4, TARGETS_A), post);
    expectCloseToDirect(imageOf(posted, 3).data, recolour(data, SOURCES, TARGETS_B));
    expect([...imageOf(posted, 4).data]).toEqual([...imageOf(posted, 2).data]);
  });

  it('does not alter the pixel buffer it was given', async () => {
    const data = pixels(5);
    const copy = Uint8ClampedArray.from(data);
    const { post } = recorder();
    const handler = createRecolourHandler(immediate());
    await handler.handle(prepareRequest(1, data), post);
    await handler.handle(recolourRequest(2), post);
    expect([...data]).toEqual([...copy]);
  });

  it('works with the default yield', async () => {
    const { posted, post } = recorder();
    const handler = createRecolourHandler();
    await handler.handle(prepareRequest(1), post);
    await handler.handle(recolourRequest(2), post);
    expect(imagesWithId(posted, 2)).toHaveLength(1);
  });

  it('waits for the yield before posting a recolour result', async () => {
    const gate = armedTick();
    const { posted, post } = recorder();
    const handler = createRecolourHandler({ yieldTick: gate.yieldTick });
    await handler.handle(prepareRequest(1), post);
    gate.arm();
    const run = handler.handle(recolourRequest(2), post);
    await flushMacrotask();
    expect(imagesWithId(posted, 2)).toEqual([]);
    gate.release();
    await run;
    expect(imagesWithId(posted, 2)).toHaveLength(1);
  });
});

describe('recolour handler: latest request wins', () => {
  async function overlap(firstId: number, secondId: number, data: Uint8ClampedArray) {
    const gate = armedTick();
    const { posted, post } = recorder();
    const handler = createRecolourHandler({ yieldTick: gate.yieldTick });
    await handler.handle(prepareRequest(1, data), post);
    gate.arm();
    const first = handler.handle(recolourRequest(firstId, TARGETS_A), post);
    const second = handler.handle(recolourRequest(secondId, TARGETS_B), post);
    gate.release();
    await Promise.all([first, second]);
    return posted;
  }

  it('never posts a superseded recolour (neither image nor error) and posts the newer one', async () => {
    const posted = await overlap(2, 3, pixels());
    expect(imagesWithId(posted, 2)).toEqual([]);
    expect(errorsWithId(posted, 2)).toEqual([]);
    expect(imagesWithId(posted, 3)).toHaveLength(1);
  });

  it('treats the most recent call as the winner, not the highest id', async () => {
    const posted = await overlap(9, 5, pixels());
    expect(imagesWithId(posted, 9)).toEqual([]);
    expect(imagesWithId(posted, 5)).toHaveLength(1);
  });

  it('answers the newest recolour correctly after a superseded one was dropped', async () => {
    const data = pixels(6);
    const posted = await overlap(2, 3, data);
    expectCloseToDirect(imageOf(posted, 3).data, recolour(data, SOURCES, TARGETS_B));
  });

  it('posts a superseded run nothing even when it is held until after the newer one finished', async () => {
    const gate = armedTick();
    const { posted, post } = recorder();
    const handler = createRecolourHandler({ yieldTick: gate.yieldTick });
    await handler.handle(prepareRequest(1), post);
    gate.arm();
    const first = handler.handle(recolourRequest(2, TARGETS_A), post);
    await flushMacrotask();
    const second = handler.handle(recolourRequest(3, TARGETS_B), post);
    gate.release();
    await Promise.all([first, second]);
    expect(posted.map((r) => r.id).filter((id) => id === 2 || id === 3)).toEqual([3]);
  });
});

describe('recolour handler: failures', () => {
  it('posts an error carrying the request id when recolour arrives before prepare', async () => {
    const { posted, post } = recorder();
    await createRecolourHandler(immediate()).handle(recolourRequest(7), post);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: 'error', id: 7 });
    expect(posted[0]?.type === 'error' && posted[0].message.length > 0).toBe(true);
  });

  it('posts an error when the number of targets differs from the prepared sources', async () => {
    const { posted, post } = recorder();
    const handler = createRecolourHandler(immediate());
    await handler.handle(prepareRequest(1), post);
    await handler.handle(recolourRequest(2, [...TARGETS_A, labOf('#123456')]), post);
    expect(errorsWithId(posted, 2)).toHaveLength(1);
    expect(imagesWithId(posted, 2)).toEqual([]);
  });

  it('uses the sources of the latest prepare, so targets for the old palette size are an error', async () => {
    const { posted, post } = recorder();
    const handler = createRecolourHandler(immediate());
    await handler.handle(prepareRequest(1), post);
    await handler.handle(prepareRequest(2, pixels(7), [...SOURCES, labOf('#123456')]), post);
    await handler.handle(recolourRequest(3, TARGETS_A), post);
    expect(errorsWithId(posted, 3)).toHaveLength(1);
    await handler.handle(recolourRequest(4, [...TARGETS_A, labOf('#654321')]), post);
    expect(imagesWithId(posted, 4)).toHaveLength(1);
  });

  it('recolours a newly prepared image rather than the previous one', async () => {
    const second = pixels(8);
    const { posted, post } = recorder();
    const handler = createRecolourHandler(immediate());
    await handler.handle(prepareRequest(1, pixels(9)), post);
    await handler.handle(prepareRequest(2, second), post);
    await handler.handle(recolourRequest(3), post);
    expectCloseToDirect(imageOf(posted, 3).data, recolour(second, SOURCES, TARGETS_A));
  });

  const bad = () => prepareRequest(5);

  it.each([
    ['wrong data length', () => ({ ...bad(), image: { width: 3, height: 3, data: new Uint8ClampedArray(10) } }), 5],
    [
      'oversized side',
      () => ({ ...bad(), image: { width: 2049, height: 1, data: new Uint8ClampedArray(2049 * 4) } }),
      5,
    ],
    ['no sources', () => ({ ...bad(), sources: [] }), 5],
    ['NaN source', () => ({ ...bad(), sources: [[Number.NaN, 0, 0], ...lab3(SOURCES.slice(1))] }), 5],
    ['unknown type with an id', () => ({ type: 'explode', id: 11 }), 11],
    ['missing id', () => ({ type: 'recolour', targets: lab3(TARGETS_A) }), null],
    ['recolour with bad targets', () => ({ type: 'recolour', id: 12, targets: [[1, 2]] }), 12],
    ['null', () => null, null],
    ['a string', () => 'prepare', null],
    ['undefined', () => undefined, null],
    ['an empty object', () => ({}), null],
  ])('posts a single error and does not throw for %s', async (_name, make, expectedId) => {
    const { posted, post } = recorder();
    await expect(createRecolourHandler(immediate()).handle(make(), post)).resolves.toBeUndefined();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: 'error', id: expectedId });
    expect(posted[0]?.type === 'error' && posted[0].message.length > 0).toBe(true);
  });

  it('does not cache the image of an invalid prepare request', async () => {
    const { posted, post } = recorder();
    const handler = createRecolourHandler(immediate());
    await handler.handle({ ...prepareRequest(1), sources: lab3(SOURCES.slice(0, 2)) }, post);
    await handler.handle(recolourRequest(2), post);
    expect(errorsWithId(posted, 2)).toHaveLength(1);
  });

  it('keeps the cached image when a later prepare request is invalid', async () => {
    const data = pixels(10);
    const { posted, post } = recorder();
    const handler = createRecolourHandler(immediate());
    await handler.handle(prepareRequest(1, data), post);
    await handler.handle(
      { ...prepareRequest(2), image: { width: 3, height: 3, data: new Uint8ClampedArray(5) } },
      post,
    );
    await handler.handle(recolourRequest(3), post);
    expectCloseToDirect(imageOf(posted, 3).data, recolour(data, SOURCES, TARGETS_A));
  });

  it('keeps the cached image when a recolour request is invalid', async () => {
    const data = pixels(11);
    const { posted, post } = recorder();
    const handler = createRecolourHandler(immediate());
    await handler.handle(prepareRequest(1, data), post);
    await handler.handle({ type: 'recolour', id: 2, targets: [[Number.NaN, 0, 0]] }, post);
    await handler.handle(recolourRequest(3), post);
    expectCloseToDirect(imageOf(posted, 3).data, recolour(data, SOURCES, TARGETS_A));
  });

  it('posts an error for the request id when the yield fails, and does not throw itself', async () => {
    const { posted, post } = recorder();
    let failing = false;
    const handler = createRecolourHandler({
      yieldTick: () => (failing ? Promise.reject(new Error('tick failed')) : Promise.resolve()),
    });
    await handler.handle(prepareRequest(1), post);
    failing = true;
    await expect(handler.handle(recolourRequest(2), post)).resolves.toBeUndefined();
    expect(errorsWithId(posted, 2)).toHaveLength(1);
  });

  it('keeps working after an invalid request', async () => {
    const { posted, post } = recorder();
    const handler = createRecolourHandler(immediate());
    await handler.handle(null, post);
    await handler.handle(prepareRequest(1), post);
    await handler.handle(recolourRequest(2), post);
    expect(imagesWithId(posted, 2)).toHaveLength(1);
  });
});

describe('recolour handler: preview and final quality', () => {
  const withQuality = (id: number, quality: unknown) => ({ ...recolourRequest(id), quality });
  const maxDelta = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
    let worst = 0;
    for (let p = 0; p < a.length / 4; p++) {
      const rgb = (d: Uint8ClampedArray) => [d[p * 4] ?? -1, d[p * 4 + 1] ?? -1, d[p * 4 + 2] ?? -1] as const;
      worst = Math.max(worst, deltaE2000(rgbToLab(rgb(a)), rgbToLab(rgb(b))));
    }
    return worst;
  };

  it('answers a preview request with the id, the image size and unchanged alpha', async () => {
    const { posted, post } = recorder();
    const handler = createRecolourHandler(immediate());
    const data = pixels();
    await handler.handle(prepareRequest(1, data), post);
    await handler.handle(withQuality(2, 'preview'), post);
    const image = imageOf(posted, 2);
    expect([image.width, image.height]).toEqual([8, 6]);
    for (let p = 0; p < 48; p++) expect(image.data[p * 4 + 3]).toBe(data[p * 4 + 3]);
  });

  it('keeps a preview close to the direct recolour, but not necessarily as close as a final', async () => {
    const { posted, post } = recorder();
    const handler = createRecolourHandler(immediate());
    const data = pixels(7, 40, 30);
    await handler.handle(prepareRequest(1, data, SOURCES, 40, 30), post);
    await handler.handle(withQuality(2, 'preview'), post);
    await handler.handle(withQuality(3, 'final'), post);
    const direct = recolour(data, SOURCES, TARGETS_A);
    expect(maxDelta(imageOf(posted, 2).data, direct)).toBeLessThan(4.5);
    expect(maxDelta(imageOf(posted, 3).data, direct)).toBeLessThan(1);
  });

  it('treats a request without quality as final', async () => {
    const { posted, post } = recorder();
    const handler = createRecolourHandler(immediate());
    await handler.handle(prepareRequest(1), post);
    await handler.handle(recolourRequest(2), post);
    await handler.handle(withQuality(3, 'final'), post);
    expect([...imageOf(posted, 2).data]).toEqual([...imageOf(posted, 3).data]);
  });

  it('rejects an unknown quality with an error for that request id', async () => {
    const { posted, post } = recorder();
    const handler = createRecolourHandler(immediate());
    await handler.handle(prepareRequest(1), post);
    await handler.handle(withQuality(4, 'draft'), post);
    expect(errorsWithId(posted, 4)).toHaveLength(1);
    expect(imagesWithId(posted, 4)).toHaveLength(0);
  });
});
