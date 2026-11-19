// Feature 005: the palette handler's 'shares' request. It samples the image, REPLACES the cached samples (as analyse
// does), yields, then posts { type: 'shares', id, shares } from swatchShares. Responses are typed loosely here so this
// file compiles before the protocol learns the new message.
import { describe, expect, it } from 'vitest';

import { bands, checkerboard, solidImage } from '../../tests/helpers/colour';
import { hexToRgb, rgbToLab } from '../lib/colour/convert';
import type { PixelBuffer } from '../lib/colour/types';
import { createPaletteHandler } from './palette-handler';

const RED = '#C0392B';
const BLUE = '#2E86C1';
const GREEN = '#27AE60';

type Posted = { type: string; id?: number | null; shares?: number[]; swatches?: { hex: string }[]; message?: string };

function recorder() {
  const posted: Posted[] = [];
  return {
    posted,
    post: (response: unknown): void => {
      posted.push(response as Posted);
    },
  };
}

const imageOf = (image: PixelBuffer) => ({ width: image.width, height: image.height, data: image.data });
const labOf = (hex: string) => [...rgbToLab(hexToRgb(hex))];

function sharesRequest(id: number, labs: number[][], image: PixelBuffer) {
  return { type: 'shares', id, labs, image: imageOf(image) };
}

function analyseRequest(id: number, k: number, image: PixelBuffer) {
  return { type: 'analyse', id, k, image: imageOf(image) };
}

const immediate = () => ({ yieldTick: () => Promise.resolve() });

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

const flushMacrotask = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

// 10 wide: 3 rows red (30 px), 1 row blue (10 px) -> 0.75 / 0.25 of the 40 opaque pixels.
const redBlueBands = () =>
  bands(10, [
    { hex: RED, rows: 3 },
    { hex: BLUE, rows: 1 },
  ]);

describe('palette handler: shares', () => {
  it('posts one shares response with the id and the fraction of pixels nearest each swatch', async () => {
    const { posted, post } = recorder();
    await createPaletteHandler(immediate()).handle(sharesRequest(7, [labOf(RED), labOf(BLUE)], redBlueBands()), post);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.type).toBe('shares');
    expect(posted[0]?.id).toBe(7);
    expect(posted[0]?.shares).toHaveLength(2);
    expect(posted[0]?.shares?.[0]).toBeCloseTo(0.75, 12);
    expect(posted[0]?.shares?.[1]).toBeCloseTo(0.25, 12);
  });

  it('keeps the order of the requested labs, not of the dominant colour', async () => {
    const { posted, post } = recorder();
    await createPaletteHandler(immediate()).handle(
      sharesRequest(1, [labOf(BLUE), labOf(RED), labOf(GREEN)], redBlueBands()),
      post,
    );
    const out = posted[0]?.shares ?? [];
    expect(out[0]).toBeCloseTo(0.25, 12);
    expect(out[1]).toBeCloseTo(0.75, 12);
    expect(out[2]).toBe(0);
  });

  it('gives a checkerboard of two colours 0.5 each', async () => {
    const { posted, post } = recorder();
    await createPaletteHandler(immediate()).handle(
      sharesRequest(2, [labOf(RED), labOf(BLUE)], checkerboard(RED, BLUE, 8)),
      post,
    );
    expect(posted[0]?.shares?.[0]).toBeCloseTo(0.5, 12);
    expect(posted[0]?.shares?.[1]).toBeCloseTo(0.5, 12);
  });

  it('accepts a single lab and gives it the whole share', async () => {
    const { posted, post } = recorder();
    await createPaletteHandler(immediate()).handle(sharesRequest(3, [labOf(RED)], redBlueBands()), post);
    expect(posted[0]?.shares).toEqual([1]);
  });

  it('accepts eight labs', async () => {
    const { posted, post } = recorder();
    const labs = Array.from({ length: 8 }, (_, i) => [10 * i, 0, 0]);
    await createPaletteHandler(immediate()).handle(sharesRequest(3, labs, redBlueBands()), post);
    expect(posted[0]?.shares).toHaveLength(8);
  });

  it('posts all-zero shares for a transparent-only image rather than NaN', async () => {
    const { posted, post } = recorder();
    await createPaletteHandler(immediate()).handle(
      sharesRequest(4, [labOf(RED), labOf(BLUE)], solidImage(4, 4, [1, 2, 3], 0)),
      post,
    );
    expect(posted).toEqual([{ type: 'shares', id: 4, shares: [0, 0] }]);
  });

  it('works with the default yield', async () => {
    const { posted, post } = recorder();
    await createPaletteHandler().handle(sharesRequest(5, [labOf(RED), labOf(BLUE)], redBlueBands()), post);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.type).toBe('shares');
  });

  it('waits for the yield before posting', async () => {
    const tick = controlledTick();
    const { posted, post } = recorder();
    const run = createPaletteHandler({ yieldTick: tick.yieldTick }).handle(
      sharesRequest(1, [labOf(RED), labOf(BLUE)], redBlueBands()),
      post,
    );
    await flushMacrotask();
    expect(tick.calls()).toBeGreaterThanOrEqual(1);
    expect(posted).toEqual([]);
    tick.release();
    await run;
    expect(posted).toHaveLength(1);
    expect(posted[0]?.type).toBe('shares');
  });
});

describe('palette handler: shares and the sample cache', () => {
  it('lets a later set-k work without re-sending the image, and returns a normal palette response', async () => {
    const { posted, post } = recorder();
    const handler = createPaletteHandler(immediate());
    await handler.handle(sharesRequest(1, [labOf(RED), labOf(BLUE)], checkerboard(RED, BLUE, 8)), post);
    await handler.handle({ type: 'set-k', id: 2, k: 5 }, post);
    expect(posted).toHaveLength(2);
    expect(posted[1]?.type).toBe('palette');
    expect(posted[1]?.id).toBe(2);
    expect(posted[1]?.swatches?.map((s) => s.hex)).toEqual([BLUE, RED]);
  });

  it('replaces the cached samples of an earlier analyse', async () => {
    const { posted, post } = recorder();
    const handler = createPaletteHandler(immediate());
    await handler.handle(analyseRequest(1, 4, solidImage(4, 4, hexToRgb(GREEN))), post);
    await handler.handle(sharesRequest(2, [labOf(RED), labOf(BLUE)], checkerboard(RED, BLUE, 8)), post);
    await handler.handle({ type: 'set-k', id: 3, k: 4 }, post);
    expect(posted[2]?.swatches?.map((s) => s.hex)).toEqual([BLUE, RED]);
  });

  it('is replaced in turn by a later analyse', async () => {
    const { posted, post } = recorder();
    const handler = createPaletteHandler(immediate());
    await handler.handle(sharesRequest(1, [labOf(RED)], checkerboard(RED, BLUE, 8)), post);
    await handler.handle(analyseRequest(2, 4, solidImage(4, 4, hexToRgb(GREEN))), post);
    await handler.handle({ type: 'set-k', id: 3, k: 4 }, post);
    expect(posted[2]?.swatches?.map((s) => s.hex)).toEqual([GREEN]);
  });

  it('answers set-k with an error when only an invalid shares request has been seen', async () => {
    const { posted, post } = recorder();
    const handler = createPaletteHandler(immediate());
    await handler.handle(sharesRequest(1, [], checkerboard(RED, BLUE, 8)), post);
    await handler.handle({ type: 'set-k', id: 2, k: 5 }, post);
    expect(posted[1]).toMatchObject({ type: 'error', id: 2 });
  });
});

describe('palette handler: shares, latest request wins', () => {
  it('posts only the second response when two shares requests overlap', async () => {
    const tick = controlledTick();
    const { posted, post } = recorder();
    const handler = createPaletteHandler({ yieldTick: tick.yieldTick });
    const first = handler.handle(sharesRequest(1, [labOf(RED), labOf(BLUE)], redBlueBands()), post);
    const second = handler.handle(sharesRequest(2, [labOf(RED), labOf(BLUE)], checkerboard(RED, BLUE, 8)), post);
    tick.release();
    await Promise.all([first, second]);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.id).toBe(2);
    expect(posted[0]?.shares?.[0]).toBeCloseTo(0.5, 12);
  });

  it('posts nothing for a shares request superseded by an analyse', async () => {
    const tick = controlledTick();
    const { posted, post } = recorder();
    const handler = createPaletteHandler({ yieldTick: tick.yieldTick });
    const first = handler.handle(sharesRequest(1, [labOf(RED), labOf(BLUE)], redBlueBands()), post);
    const second = handler.handle(analyseRequest(2, 4, checkerboard(RED, BLUE, 4)), post);
    tick.release();
    await Promise.all([first, second]);
    expect(posted.map((r) => r.type)).toEqual(['palette']);
    expect(posted[0]?.id).toBe(2);
  });

  it('posts nothing for an analyse superseded by a shares request', async () => {
    const tick = controlledTick();
    const { posted, post } = recorder();
    const handler = createPaletteHandler({ yieldTick: tick.yieldTick });
    const first = handler.handle(analyseRequest(1, 4, checkerboard(RED, BLUE, 4)), post);
    const second = handler.handle(sharesRequest(2, [labOf(RED), labOf(BLUE)], redBlueBands()), post);
    tick.release();
    await Promise.all([first, second]);
    expect(posted.map((r) => r.type)).toEqual(['shares']);
    expect(posted[0]?.id).toBe(2);
  });

  it('posts nothing for a superseded shares request even when its yield fails', async () => {
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
    const first = handler.handle(sharesRequest(1, [labOf(RED), labOf(BLUE)], redBlueBands()), post);
    const second = handler.handle(sharesRequest(2, [labOf(RED), labOf(BLUE)], redBlueBands()), post);
    rejectFirst(new Error('boom'));
    await Promise.all([first, second]);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.type).toBe('shares');
    expect(posted[0]?.id).toBe(2);
  });
});

describe('palette handler: shares failures', () => {
  const goodImage = () => redBlueBands();
  const two = () => [labOf(RED), labOf(BLUE)];

  it('posts an error for the request id when the run throws, and does not throw itself', async () => {
    const { posted, post } = recorder();
    const handler = createPaletteHandler({ yieldTick: () => Promise.reject(new Error('tick failed')) });
    await expect(handler.handle(sharesRequest(5, two(), goodImage()), post)).resolves.toBeUndefined();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: 'error', id: 5 });
  });

  it.each([
    ['0 labs', { ...sharesRequest(4, [], goodImage()) }],
    [
      '9 labs',
      {
        ...sharesRequest(
          4,
          Array.from({ length: 9 }, () => [50, 0, 0]),
          goodImage(),
        ),
      },
    ],
    ['a NaN lab', { ...sharesRequest(4, [[Number.NaN, 0, 0]], goodImage()) }],
    ['an Infinity lab', { ...sharesRequest(4, [[0, Number.POSITIVE_INFINITY, 0]], goodImage()) }],
    ['a short lab', { ...sharesRequest(4, [[0, 0]], goodImage()) }],
    [
      'wrong data length',
      { type: 'shares', id: 4, labs: [[1, 2, 3]], image: { width: 3, height: 3, data: new Uint8ClampedArray(10) } },
    ],
    [
      'plain-array pixel data',
      { type: 'shares', id: 4, labs: [[1, 2, 3]], image: { width: 1, height: 1, data: [0, 0, 0, 255] } },
    ],
    ['missing image', { type: 'shares', id: 4, labs: [[1, 2, 3]] }],
  ])('posts a single error with the id and does not throw for %s', async (_name, request) => {
    const { posted, post } = recorder();
    await expect(createPaletteHandler(immediate()).handle(request, post)).resolves.toBeUndefined();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: 'error', id: 4 });
    expect(posted[0]?.message?.length).toBeGreaterThan(0);
  });

  it('posts an error with a null id when a shares request has no usable id', async () => {
    const { posted, post } = recorder();
    await createPaletteHandler(immediate()).handle(
      { type: 'shares', labs: [[1, 2, 3]], image: imageOf(goodImage()) },
      post,
    );
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: 'error', id: null });
  });

  it.each([
    ['0 labs', (image: PixelBuffer) => sharesRequest(2, [], image)],
    ['a NaN lab', (image: PixelBuffer) => sharesRequest(2, [[Number.NaN, 0, 0]], image)],
    [
      'a bad image',
      () => ({
        type: 'shares',
        id: 2,
        labs: [[1, 2, 3]],
        image: { width: 3, height: 3, data: new Uint8ClampedArray(10) },
      }),
    ],
  ])('does not wipe the cached samples when a shares request with %s is rejected', async (_name, build) => {
    const { posted, post } = recorder();
    const handler = createPaletteHandler(immediate());
    await handler.handle(analyseRequest(1, 4, checkerboard(RED, BLUE, 8)), post);
    // A different valid image rides along with the bad request: it must not replace the cache.
    await handler.handle(build(solidImage(4, 4, hexToRgb(GREEN))), post);
    await handler.handle({ type: 'set-k', id: 3, k: 4 }, post);
    expect(posted.map((r) => r.type)).toEqual(['palette', 'error', 'palette']);
    expect(posted[2]?.swatches?.map((s) => s.hex)).toEqual([BLUE, RED]);
  });

  it('does not supersede an in-flight run when its own request is invalid', async () => {
    const tick = controlledTick();
    const { posted, post } = recorder();
    const handler = createPaletteHandler({ yieldTick: tick.yieldTick });
    const first = handler.handle(sharesRequest(1, two(), goodImage()), post);
    await handler.handle(sharesRequest(2, [], goodImage()), post);
    tick.release();
    await first;
    expect(posted.map((r) => r.type)).toEqual(['error', 'shares']);
    expect(posted[1]?.id).toBe(1);
  });

  it('keeps working after an invalid shares request', async () => {
    const { posted, post } = recorder();
    const handler = createPaletteHandler(immediate());
    await handler.handle(sharesRequest(1, [], goodImage()), post);
    await handler.handle(sharesRequest(2, two(), goodImage()), post);
    expect(posted[1]?.type).toBe('shares');
    expect(posted[1]?.id).toBe(2);
  });
});
