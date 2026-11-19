import { afterEach, describe, expect, it, vi } from 'vitest';
import { wallPlan } from '@/lib/wall/plan';
import { WHOLE } from '@/lib/wall/region';
import type { ExportSource } from './exportPng';
import { paintSource, paintWall, WALL_H, WALL_W } from './wallDraw';

type Call = [string, ...unknown[]];

/** A canvas that records what is drawn on it and every time its size is assigned. */
function fakeCanvas(width = 0, height = 0, hasContext = true) {
  const calls: Call[] = [];
  const sizeSets: string[] = [];
  const context = {
    clearRect: (...args: number[]) => {
      calls.push(['clearRect', ...args]);
    },
    putImageData: (...args: unknown[]) => {
      calls.push(['putImageData', ...args]);
    },
    drawImage: (...args: unknown[]) => {
      calls.push(['drawImage', ...args]);
    },
  };
  let w = width;
  let h = height;
  const canvas = {
    get width() {
      return w;
    },
    set width(value: number) {
      sizeSets.push(`width=${String(value)}`);
      w = value;
    },
    get height() {
      return h;
    },
    set height(value: number) {
      sizeSets.push(`height=${String(value)}`);
      h = value;
    },
    getContext: (kind: string) => (hasContext && kind === '2d' ? context : null),
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, calls, sizeSets };
}

class FakeImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

const frameSource = (width: number, height: number): ExportSource => ({
  kind: 'frame',
  frame: { width, height, data: new Uint8ClampedArray(width * height * 4) },
});
const imageSource = (naturalWidth: number, naturalHeight: number): ExportSource => ({
  kind: 'image',
  image: { naturalWidth, naturalHeight } as unknown as HTMLImageElement,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('paintSource', () => {
  it('sizes the canvas to a frame and puts its pixels there', () => {
    vi.stubGlobal('ImageData', FakeImageData);
    const { canvas, calls } = fakeCanvas();
    const source = frameSource(4, 2);

    paintSource(canvas, source);

    expect([canvas.width, canvas.height]).toEqual([4, 2]);
    expect(calls).toHaveLength(1);
    const [name, data, x, y] = calls[0] as [string, FakeImageData, number, number];
    expect([name, x, y]).toEqual(['putImageData', 0, 0]);
    expect([data.width, data.height]).toEqual([4, 2]);
    expect(source.kind === 'frame' && data.data === source.frame.data).toBe(true);
  });

  it('clears, then draws an image at its natural size', () => {
    const { canvas, calls } = fakeCanvas();
    const source = imageSource(6, 3);

    paintSource(canvas, source);

    expect([canvas.width, canvas.height]).toEqual([6, 3]);
    expect(calls).toEqual([
      ['clearRect', 0, 0, 6, 3],
      ['drawImage', source.kind === 'image' ? source.image : null, 0, 0, 6, 3],
    ]);
  });

  it('does not reassign a size that has not changed (it would reallocate the bitmap)', () => {
    const { canvas, sizeSets } = fakeCanvas(6, 3);

    paintSource(canvas, imageSource(6, 3));

    expect(sizeSets).toEqual([]);
  });

  it('assigns only the side that changed', () => {
    const { canvas, sizeSets } = fakeCanvas(6, 1);

    paintSource(canvas, imageSource(6, 3));

    expect(sizeSets).toEqual(['height=3']);
  });

  it('draws nothing for an image that has not loaded yet', () => {
    const { canvas, calls } = fakeCanvas(5, 5);

    paintSource(canvas, imageSource(0, 0));

    expect(calls).toEqual([]);
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });

  it('draws nothing, and does not throw, without a 2d context', () => {
    const { canvas, calls } = fakeCanvas(0, 0, false);

    expect(() => {
      paintSource(canvas, imageSource(6, 3));
    }).not.toThrow();
    expect(calls).toEqual([]);
  });
});

describe('paintWall', () => {
  const draw = (repeat: 'straight' | 'half-drop') => {
    const full = fakeCanvas(800, 600).canvas;
    const wall = fakeCanvas();
    paintWall(wall.canvas, full, WHOLE, 4, repeat);
    const plan = wallPlan({
      region: WHOLE,
      imageW: 800,
      imageH: 600,
      wallW: WALL_W,
      wallH: WALL_H,
      repeats: 4,
      repeat,
    });
    return { full, wall, plan };
  };

  it.each(['straight', 'half-drop'] as const)('clears the wall, then draws every planned tile (%s)', (repeat) => {
    const { full, wall, plan } = draw(repeat);

    expect(wall.calls[0]).toEqual(['clearRect', 0, 0, WALL_W, WALL_H]);
    expect(wall.calls.slice(1)).toEqual(
      plan.tiles.map((at) => [
        'drawImage',
        full,
        plan.source.x,
        plan.source.y,
        plan.source.w,
        plan.source.h,
        at.x,
        at.y,
        at.w,
        at.h,
      ]),
    );
  });

  it('draws more tiles for a half-drop repeat (the dropped columns have an extra tile)', () => {
    expect(draw('half-drop').wall.calls.length).toBeGreaterThan(draw('straight').wall.calls.length);
  });

  it('draws nothing before the whole picture has been painted', () => {
    const wall = fakeCanvas();

    paintWall(wall.canvas, fakeCanvas(0, 0).canvas, WHOLE, 4, 'straight');

    expect(wall.calls).toEqual([]);
  });

  it('draws nothing, and does not throw, without a 2d context', () => {
    const wall = fakeCanvas(0, 0, false);

    expect(() => {
      paintWall(wall.canvas, fakeCanvas(800, 600).canvas, WHOLE, 4, 'straight');
    }).not.toThrow();
    expect(wall.calls).toEqual([]);
  });
});
