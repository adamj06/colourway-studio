import { describe, expect, it } from 'vitest';

import { bands, buildImage, checkerboard, solidImage } from '../../tests/helpers/colour';
import { extractPalette } from '../lib/colour/palette';
import { mulberry32 } from '../lib/colour/prng';
import type { PixelBuffer } from '../lib/colour/types';
import { createPaletteHandler } from './palette-handler';
import type { PaletteResponse } from './palette-protocol';

const RED = '#C0392B';
const BLUE = '#2E86C1';
const FIVE = ['#C0392B', '#2E86C1', '#27AE60', '#F1C40F', '#8E44AD'];

/** A yieldTick whose pending promises are released by the test. After release() ticks resolve immediately. */
function controlledTick() {
  const pending: (() => void)[] = [];
  let open = false;
  let calls = 0;
  return {
    yieldTick: (): Promise<void> => {
      calls += 1;
      if (open) return Promise.resolve();
      return new Promise<void>((resolve) => {
        pending.push(resolve);
      });
    },
    release: (): void => {
      open = true;
      pending.splice(0).forEach((resolve) => {
        resolve();
      });
    },
    calls: (): number => calls,
  };
}

function recorder() {
  const posted: PaletteResponse[] = [];
  return {
    posted,
    post: (response: PaletteResponse): void => {
      posted.push(response);
    },
  };
}

function analyseRequest(id: number, k: number, image: PixelBuffer) {
  return { type: 'analyse', id, k, image: { width: image.width, height: image.height, data: image.data } };
}

function immediate() {
  return { yieldTick: () => Promise.resolve() };
}

function paletteOf(response: PaletteResponse | undefined) {
  if (response?.type !== 'palette') throw new Error(`expected a palette response, got ${JSON.stringify(response)}`);
  return response;
}

function flushMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

const fiveColourImage = () =>
  bands(
    10,
    FIVE.map((hex, i) => ({ hex, rows: i + 1 })),
  );

describe('palette handler: analyse', () => {
  it('posts one palette response with the two colours of a checkerboard at share 0.5', async () => {
    const { posted, post } = recorder();
    await createPaletteHandler(immediate()).handle(analyseRequest(7, 6, checkerboard(RED, BLUE, 16)), post);
    expect(posted).toHaveLength(1);
    const response = paletteOf(posted[0]);
    expect(response.id).toBe(7);
    expect(response.k).toBe(6);
    expect(response.swatches.map((s) => s.hex)).toEqual([BLUE, RED]);
    for (const s of response.swatches) {
      expect(s.share).toBeCloseTo(0.5, 9);
    }
  });

  it('posts a palette with no swatches for a transparent-only image', async () => {
    const { posted, post } = recorder();
    await createPaletteHandler(immediate()).handle(analyseRequest(2, 5, solidImage(4, 4, [1, 2, 3], 0)), post);
    expect(posted).toEqual([{ type: 'palette', id: 2, k: 5, swatches: [] }]);
  });

  it('works with the default yield', async () => {
    const { posted, post } = recorder();
    await createPaletteHandler().handle(analyseRequest(3, 4, checkerboard(RED, BLUE, 4)), post);
    expect(posted).toHaveLength(1);
    expect(paletteOf(posted[0]).swatches).toHaveLength(2);
  });

  it('waits for the yield before posting', async () => {
    const tick = controlledTick();
    const { posted, post } = recorder();
    const run = createPaletteHandler({ yieldTick: tick.yieldTick }).handle(
      analyseRequest(1, 4, checkerboard(RED, BLUE, 4)),
      post,
    );
    await flushMacrotask();
    expect(tick.calls()).toBeGreaterThanOrEqual(1);
    expect(posted).toEqual([]);
    tick.release();
    await run;
    expect(posted).toHaveLength(1);
  });

  it('yields at least once for set-k as well', async () => {
    const tick = controlledTick();
    tick.release();
    const { post } = recorder();
    const handler = createPaletteHandler({ yieldTick: tick.yieldTick });
    await handler.handle(analyseRequest(1, 4, fiveColourImage()), post);
    const before = tick.calls();
    await handler.handle({ type: 'set-k', id: 2, k: 5 }, post);
    expect(tick.calls()).toBeGreaterThan(before);
  });

  it('answers each of two sequential, awaited requests', async () => {
    const { posted, post } = recorder();
    const handler = createPaletteHandler(immediate());
    await handler.handle(analyseRequest(1, 4, checkerboard(RED, BLUE, 4)), post);
    await handler.handle(analyseRequest(2, 4, checkerboard(RED, BLUE, 4)), post);
    expect(posted.map((r) => (r.type === 'palette' ? r.id : -1))).toEqual([1, 2]);
  });
});

describe('palette handler: set-k', () => {
  it('re-extracts from the cached samples with a new k and no new pixels', async () => {
    const { posted, post } = recorder();
    const handler = createPaletteHandler(immediate());
    await handler.handle(analyseRequest(1, 4, fiveColourImage()), post);
    await handler.handle({ type: 'set-k', id: 2, k: 5 }, post);
    expect(posted).toHaveLength(2);
    const first = paletteOf(posted[0]);
    const second = paletteOf(posted[1]);
    expect(first.id).toBe(1);
    expect(first.k).toBe(4);
    expect(first.swatches).toHaveLength(4);
    expect(second.id).toBe(2);
    expect(second.k).toBe(5);
    expect(second.swatches).toHaveLength(5);
    expect(second.swatches.map((s) => s.hex).sort()).toEqual([...FIVE].sort());
  });

  it('can lower k again from the same cached image', async () => {
    const { posted, post } = recorder();
    const handler = createPaletteHandler(immediate());
    await handler.handle(analyseRequest(1, 5, fiveColourImage()), post);
    await handler.handle({ type: 'set-k', id: 2, k: 4 }, post);
    expect(paletteOf(posted[1]).swatches).toHaveLength(4);
    await handler.handle({ type: 'set-k', id: 3, k: 5 }, post);
    expect(paletteOf(posted[2]).swatches).toHaveLength(5);
  });

  it('uses the most recently analysed image', async () => {
    const { posted, post } = recorder();
    const handler = createPaletteHandler(immediate());
    await handler.handle(analyseRequest(1, 4, fiveColourImage()), post);
    await handler.handle(analyseRequest(2, 4, checkerboard(RED, BLUE, 4)), post);
    await handler.handle({ type: 'set-k', id: 3, k: 6 }, post);
    expect(paletteOf(posted[2]).swatches.map((s) => s.hex)).toEqual([BLUE, RED]);
  });

  it('posts an error for the request id when nothing has been analysed yet', async () => {
    const { posted, post } = recorder();
    await createPaletteHandler(immediate()).handle({ type: 'set-k', id: 9, k: 5 }, post);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: 'error', id: 9 });
    expect(posted[0]?.type === 'error' && posted[0].message.length > 0).toBe(true);
  });
});

describe('palette handler: latest request wins', () => {
  it('posts only the second palette when two analyse calls overlap', async () => {
    const tick = controlledTick();
    const { posted, post } = recorder();
    const handler = createPaletteHandler({ yieldTick: tick.yieldTick });
    const first = handler.handle(analyseRequest(1, 4, fiveColourImage()), post);
    const second = handler.handle(analyseRequest(2, 4, checkerboard(RED, BLUE, 4)), post);
    tick.release();
    await Promise.all([first, second]);
    expect(posted).toHaveLength(1);
    const response = paletteOf(posted[0]);
    expect(response.id).toBe(2);
    expect(response.swatches.map((s) => s.hex)).toEqual([BLUE, RED]);
  });

  it('treats the most recent call as the winner, not the highest id', async () => {
    const tick = controlledTick();
    const { posted, post } = recorder();
    const handler = createPaletteHandler({ yieldTick: tick.yieldTick });
    const first = handler.handle(analyseRequest(9, 4, fiveColourImage()), post);
    const second = handler.handle(analyseRequest(2, 4, checkerboard(RED, BLUE, 4)), post);
    tick.release();
    await Promise.all([first, second]);
    expect(posted.map((r) => (r.type === 'palette' ? r.id : -1))).toEqual([2]);
  });

  it('reports the k of the winning request when overlapping calls ask for different k', async () => {
    const tick = controlledTick();
    const { posted, post } = recorder();
    const handler = createPaletteHandler({ yieldTick: tick.yieldTick });
    const first = handler.handle(analyseRequest(10, 4, fiveColourImage()), post);
    const second = handler.handle(analyseRequest(11, 5, fiveColourImage()), post);
    tick.release();
    await Promise.all([first, second]);
    expect(posted).toHaveLength(1);
    expect(paletteOf(posted[0]).k).toBe(5);
    expect(paletteOf(posted[0]).swatches).toHaveLength(5);
  });

  it('posts nothing for a superseded run even when that run fails', async () => {
    const { posted, post } = recorder();
    let rejectFirst: (error: Error) => void = () => undefined;
    let calls = 0;
    const handler = createPaletteHandler({
      yieldTick: () => {
        calls += 1;
        if (calls === 1) {
          return new Promise<void>((_resolve, reject) => {
            rejectFirst = reject;
          });
        }
        return Promise.resolve();
      },
    });
    const first = handler.handle(analyseRequest(1, 4, fiveColourImage()), post);
    const second = handler.handle(analyseRequest(2, 4, checkerboard(RED, BLUE, 4)), post);
    rejectFirst(new Error('boom'));
    await Promise.all([first, second]);
    expect(posted).toHaveLength(1);
    expect(paletteOf(posted[0]).id).toBe(2);
  });
});

describe('palette handler: failures', () => {
  it('posts an error for the request id when the run throws, and does not throw itself', async () => {
    const { posted, post } = recorder();
    const handler = createPaletteHandler({ yieldTick: () => Promise.reject(new Error('tick failed')) });
    await expect(handler.handle(analyseRequest(5, 4, checkerboard(RED, BLUE, 4)), post)).resolves.toBeUndefined();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: 'error', id: 5 });
    expect(posted[0]?.type === 'error' && posted[0].message.length > 0).toBe(true);
  });

  const good = () => ({ ...analyseRequest(4, 6, checkerboard(RED, BLUE, 2)) });

  it.each([
    ['k below range', { ...good(), k: 3 }, 4],
    ['k above range', { ...good(), k: 9 }, 4],
    ['fractional k', { ...good(), k: 5.5 }, 4],
    ['wrong data length', { ...good(), image: { width: 3, height: 3, data: new Uint8ClampedArray(10) } }, 4],
    ['plain-array pixel data', { ...good(), image: { width: 1, height: 1, data: [0, 0, 0, 255] } }, 4],
    ['unknown type with an id', { type: 'explode', id: 11, k: 5 }, 11],
    ['set-k with a bad k', { type: 'set-k', id: 12, k: 99 }, 12],
    ['missing id', { type: 'set-k', k: 5 }, null],
    ['no type at all', {}, null],
    ['null', null, null],
    ['a string', 'analyse', null],
    ['a number', 42, null],
    ['an array', [], null],
    ['undefined', undefined, null],
  ])('posts a single error and does not throw for %s', async (_name, request, expectedId) => {
    const { posted, post } = recorder();
    await expect(createPaletteHandler(immediate()).handle(request, post)).resolves.toBeUndefined();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: 'error', id: expectedId });
    expect(posted[0]?.type === 'error' && posted[0].message.length > 0).toBe(true);
  });

  it('does not cache the image of an invalid analyse request', async () => {
    const { posted, post } = recorder();
    const handler = createPaletteHandler(immediate());
    await handler.handle({ ...good(), k: 3 }, post);
    await handler.handle({ type: 'set-k', id: 5, k: 5 }, post);
    expect(posted[1]).toMatchObject({ type: 'error', id: 5 });
  });

  it('keeps working after an invalid request', async () => {
    const { posted, post } = recorder();
    const handler = createPaletteHandler(immediate());
    await handler.handle(null, post);
    await handler.handle(analyseRequest(8, 4, checkerboard(RED, BLUE, 4)), post);
    expect(paletteOf(posted[1]).id).toBe(8);
  });
});

/** A yieldTick that holds every pending tick until the test releases them one at a time or all at once. */
function manualTicks() {
  const waiting: (() => void)[] = [];
  let open = false;
  let calls = 0;
  return {
    yieldTick: (): Promise<void> => {
      calls += 1;
      if (open) return Promise.resolve();
      return new Promise<void>((resolve) => {
        waiting.push(resolve);
      });
    },
    pending: (): number => waiting.length,
    releaseOldest: (): void => {
      waiting.shift()?.();
    },
    releaseAll: (): void => {
      open = true;
      waiting.splice(0).forEach((resolve) => {
        resolve();
      });
    },
    calls: (): number => calls,
  };
}

function noisyImage(): PixelBuffer {
  const rng = mulberry32(21);
  return buildImage(24, 24, () => ({
    rgb: [Math.floor(rng() * 256), Math.floor(rng() * 256), Math.floor(rng() * 256)],
  }));
}

describe('palette handler: cancellation between iterations', () => {
  it('yields to the event loop more than once during a multi-iteration run', async () => {
    const tick = controlledTick();
    tick.release();
    const { posted, post } = recorder();
    await createPaletteHandler({ yieldTick: tick.yieldTick }).handle(analyseRequest(1, 6, noisyImage()), post);
    expect(tick.calls()).toBeGreaterThan(1);
    expect(posted).toHaveLength(1);
  });

  it('stops a run superseded while waiting on an iteration tick and posts only the newer palette', async () => {
    const ticks = manualTicks();
    const { posted, post } = recorder();
    const handler = createPaletteHandler({ yieldTick: ticks.yieldTick });
    const first = handler.handle(analyseRequest(1, 6, noisyImage()), post);
    await flushMacrotask();
    expect(ticks.calls()).toBe(1);
    // Release the initial tick: the first run does one iteration, then waits on an iteration tick.
    ticks.releaseOldest();
    await flushMacrotask();
    expect(ticks.calls()).toBe(2);
    expect(ticks.pending()).toBe(1);

    // k must be 4 to 8 (requestSchema): an out-of-range k would be rejected before it ever asked for a tick.
    const second = handler.handle({ type: 'set-k', id: 2, k: 4 }, post);
    expect(ticks.calls()).toBe(3);
    // Release only the first run's tick. It must notice it was superseded and ask for no further tick.
    ticks.releaseOldest();
    await flushMacrotask();
    expect(ticks.calls()).toBe(3);
    expect(posted).toEqual([]);

    ticks.releaseAll();
    await Promise.all([first, second]);
    expect(posted).toHaveLength(1);
    expect(paletteOf(posted[0]).id).toBe(2);
    expect(paletteOf(posted[0]).k).toBe(4);
  });

  it('stops a superseded run that was waiting on its very first tick without posting for it', async () => {
    const ticks = manualTicks();
    const { posted, post } = recorder();
    const handler = createPaletteHandler({ yieldTick: ticks.yieldTick });
    const first = handler.handle(analyseRequest(1, 6, noisyImage()), post);
    await flushMacrotask();
    expect(ticks.calls()).toBe(1);
    const second = handler.handle(analyseRequest(2, 4, checkerboard(RED, BLUE, 4)), post);
    expect(ticks.calls()).toBe(2);
    ticks.releaseOldest();
    await flushMacrotask();
    expect(ticks.calls()).toBe(2);
    expect(posted).toEqual([]);

    ticks.releaseAll();
    await Promise.all([first, second]);
    expect(posted.map((r) => (r.type === 'palette' ? r.id : -1))).toEqual([2]);
  });

  it('posts the same palette as extractPalette for a multi-iteration run', async () => {
    const image = noisyImage();
    const { posted, post } = recorder();
    await createPaletteHandler(immediate()).handle(analyseRequest(1, 6, image), post);
    const expected = extractPalette(image, { k: 6 });
    expect(paletteOf(posted[0]).swatches).toEqual(expected.map((s) => ({ ...s, lab: [...s.lab] })));
  });
});
