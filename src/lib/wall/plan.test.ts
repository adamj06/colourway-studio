import { describe, expect, it } from 'vitest';
import { wallPlan } from './plan';
import { toPixels, type Region } from './region';
import { layoutTiles, tileSize, type Rect, type Repeat } from './tiles';

const WHOLE_IMAGE: Region = { x: 0, y: 0, w: 1, h: 1 };
const base = { region: WHOLE_IMAGE, imageW: 800, imageH: 600, wallW: 1200, wallH: 640, repeats: 4 };

const repeatKinds: Repeat[] = ['straight', 'half-drop'];

const coveredHalfOpen = (rects: Rect[], px: number, py: number) =>
  rects.some((r) => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h);

/** Every whole pixel of the wall that no tile covers. */
function uncoveredPixels(tiles: Rect[], wallW: number, wallH: number): string[] {
  const missing: string[] = [];
  for (let px = 0; px < wallW; px++) {
    for (let py = 0; py < wallH; py++) {
      if (!coveredHalfOpen(tiles, px, py)) missing.push(`${String(px)},${String(py)}`);
    }
  }
  return missing;
}

const column = (tiles: Rect[], x: number) => tiles.filter((t) => t.x === x).sort((a, b) => a.y - b.y);

describe('wallPlan source', () => {
  it.each<[string, Region, number, number]>([
    ['the whole image', WHOLE_IMAGE, 800, 600],
    ['the left half', { x: 0, y: 0, w: 0.5, h: 1 }, 800, 600],
    ['an off-centre box', { x: 0.1234, y: 0.3, w: 0.4321, h: 0.25 }, 1013, 777],
    ['a small corner', { x: 0.9, y: 0.9, w: 0.1, h: 0.1 }, 333, 444],
  ])('uses the whole-pixel crop of %s as the source', (_name, region, imageW, imageH) => {
    const plan = wallPlan({ ...base, region, imageW, imageH, repeat: 'straight' });
    expect(plan.source).toEqual(toPixels(region, imageW, imageH));
  });
});

describe('wallPlan tile size', () => {
  it('sizes tiles from the crop: a half-width region on 800x600 at 4 repeats on 1200 gives 300x450', () => {
    const plan = wallPlan({ ...base, wallH: 900, region: { x: 0, y: 0, w: 0.5, h: 1 }, repeat: 'straight' });
    expect(plan.source).toEqual({ x: 0, y: 0, w: 400, h: 600 });
    expect(plan.tiles.length).toBeGreaterThan(0);
    for (const t of plan.tiles) {
      expect(t.w).toBe(300);
      expect(t.h).toBe(450);
    }
  });

  it.each(repeatKinds)('gives every %s tile the tileSize of the source crop', (repeat) => {
    const region: Region = { x: 0.2, y: 0.1, w: 0.6, h: 0.5 };
    const plan = wallPlan({ ...base, region, repeats: 5, repeat });
    const size = tileSize({ wallW: 1200, repeats: 5, regionW: plan.source.w, regionH: plan.source.h });
    for (const t of plan.tiles) {
      expect(t.w).toBe(size.w);
      expect(t.h).toBe(size.h);
    }
  });
});

describe('wallPlan tiles', () => {
  it('matches layoutTiles for a straight repeat', () => {
    const plan = wallPlan({ ...base, repeat: 'straight' });
    const size = tileSize({ wallW: 1200, repeats: 4, regionW: 800, regionH: 600 });
    const expected = layoutTiles({ wallW: 1200, wallH: 640, tileW: size.w, tileH: size.h, repeat: 'straight' });
    expect(plan.tiles).toEqual(expected.map((t) => ({ ...t, x: Math.round(t.x), y: Math.round(t.y) })));
  });

  it('matches layoutTiles with rounded x and y for a half-drop repeat', () => {
    const plan = wallPlan({ ...base, repeat: 'half-drop' });
    const size = tileSize({ wallW: 1200, repeats: 4, regionW: 800, regionH: 600 });
    const expected = layoutTiles({ wallW: 1200, wallH: 640, tileW: size.w, tileH: size.h, repeat: 'half-drop' });
    expect(plan.tiles).toHaveLength(expected.length);
    expect(plan.tiles).toEqual(expected.map((t) => ({ ...t, x: Math.round(t.x), y: Math.round(t.y) })));
  });

  it('puts the straight repeat on a plain grid starting at the origin', () => {
    const plan = wallPlan({ ...base, wallH: 450, repeat: 'straight' });
    expect(plan.tiles).toContainEqual({ x: 0, y: 0, w: 300, h: 225 });
    expect(plan.tiles).toHaveLength(4 * 2);
  });

  it.each([
    ['tileH 225 (odd)', 800, 600],
    ['tileH 75 (odd)', 400, 100],
    ['tileH 150 (even)', 800, 400],
  ])('makes every x, y, w and h a whole number for both repeats: %s', (_name, imageW, imageH) => {
    for (const repeat of repeatKinds) {
      const plan = wallPlan({ ...base, imageW, imageH, repeat });
      expect(plan.tiles.length).toBeGreaterThan(0);
      for (const t of plan.tiles) {
        expect(Number.isInteger(t.x), `x ${String(t.x)}`).toBe(true);
        expect(Number.isInteger(t.y), `y ${String(t.y)}`).toBe(true);
        expect(Number.isInteger(t.w), `w ${String(t.w)}`).toBe(true);
        expect(Number.isInteger(t.h), `h ${String(t.h)}`).toBe(true);
      }
    }
  });

  it('really has an odd tile height in the odd-height cases (so the test is meaningful)', () => {
    expect(wallPlan({ ...base, repeat: 'half-drop' }).tiles[0]?.h).toBe(225);
    expect(wallPlan({ ...base, imageW: 400, imageH: 100, repeat: 'half-drop' }).tiles[0]?.h).toBe(75);
  });
});

describe('wallPlan half-drop with an odd tile height leaves no gaps', () => {
  it.each([
    ['tileH 225', 800, 600],
    ['tileH 75', 400, 100],
  ])('stacks each column edge to edge: %s', (_name, imageW, imageH) => {
    const plan = wallPlan({ ...base, imageW, imageH, repeat: 'half-drop' });
    const xs = [...new Set(plan.tiles.map((t) => t.x))];
    expect(xs.length).toBeGreaterThan(1);
    for (const x of xs) {
      const col = column(plan.tiles, x);
      for (let i = 1; i < col.length; i++) {
        const prev = col[i - 1] as Rect;
        const next = col[i] as Rect;
        expect(next.y, `column ${String(x)} tile ${String(i)}`).toBe(prev.y + prev.h);
      }
    }
  });

  it.each([
    ['tileH 225', 800, 600],
    ['tileH 75', 400, 100],
  ])('starts every column at or above the top and reaches the bottom: %s', (_name, imageW, imageH) => {
    const plan = wallPlan({ ...base, imageW, imageH, repeat: 'half-drop' });
    for (const x of new Set(plan.tiles.map((t) => t.x))) {
      const col = column(plan.tiles, x);
      const first = col[0] as Rect;
      const last = col[col.length - 1] as Rect;
      expect(first.y).toBeLessThanOrEqual(0);
      expect(last.y + last.h).toBeGreaterThanOrEqual(base.wallH);
    }
  });

  it('starts odd columns above the wall and even columns at 0', () => {
    const plan = wallPlan({ ...base, repeat: 'half-drop' });
    const xs = [...new Set(plan.tiles.map((t) => t.x))].sort((a, b) => a - b);
    xs.forEach((x, i) => {
      const first = column(plan.tiles, x)[0] as Rect;
      if (i % 2 === 0) expect(first.y).toBe(0);
      else expect(first.y).toBeLessThan(0);
    });
  });

  it.each(repeatKinds)('covers every pixel of a small odd-sized wall: %s', (repeat) => {
    const wallW = 97;
    const wallH = 61;
    for (const repeats of [2, 3, 4, 7]) {
      const plan = wallPlan({ ...base, wallW, wallH, repeats, repeat });
      expect(uncoveredPixels(plan.tiles, wallW, wallH), `${String(repeats)} repeats`).toEqual([]);
    }
  });

  it.each(repeatKinds)('has no overlapping pixels in a column on a small wall: %s', (repeat) => {
    const plan = wallPlan({ ...base, wallW: 97, wallH: 61, repeats: 4, repeat });
    for (const x of new Set(plan.tiles.map((t) => t.x))) {
      const col = column(plan.tiles, x);
      for (let i = 1; i < col.length; i++) {
        const prev = col[i - 1] as Rect;
        expect((col[i] as Rect).y).toBeGreaterThanOrEqual(prev.y + prev.h);
      }
    }
  });
});

describe('wallPlan columns', () => {
  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10])('has exactly %s columns on a 1200 wall', (repeats) => {
    for (const repeat of repeatKinds) {
      const plan = wallPlan({ ...base, repeats, repeat });
      expect(new Set(plan.tiles.map((t) => t.x)).size).toBe(repeats);
    }
  });

  it('has 7 and 9 columns with no sliver column at the right edge', () => {
    for (const repeats of [7, 9]) {
      const plan = wallPlan({ ...base, repeats, repeat: 'straight' });
      const xs = [...new Set(plan.tiles.map((t) => t.x))].sort((a, b) => a - b);
      expect(xs).toHaveLength(repeats);
      const lastX = xs[xs.length - 1] as number;
      // The last column must hold a real share of a tile, not a 1-3 px sliver.
      expect(1200 - lastX).toBeGreaterThan(lastX / (repeats - 1) / 2);
    }
  });
});

describe('wallPlan validation', () => {
  it.each([
    ['imageW 0', { imageW: 0 }],
    ['imageH 0', { imageH: 0 }],
    ['imageW negative', { imageW: -5 }],
    ['imageW NaN', { imageW: Number.NaN }],
    ['imageH NaN', { imageH: Number.NaN }],
    ['repeats 11', { repeats: 11 }],
    ['repeats 1', { repeats: 1 }],
    ['repeats 4.5', { repeats: 4.5 }],
    ['repeats NaN', { repeats: Number.NaN }],
  ])('throws a RangeError for %s', (_name, override) => {
    expect(() => wallPlan({ ...base, repeat: 'straight', ...override })).toThrow(RangeError);
  });

  it('throws a RangeError for a zero-width wall', () => {
    expect(() => wallPlan({ ...base, wallW: 0, repeat: 'straight' })).toThrow(RangeError);
  });

  it('throws a RangeError for a zero-height wall', () => {
    expect(() => wallPlan({ ...base, wallH: 0, repeat: 'half-drop' })).toThrow(RangeError);
  });

  it('throws a RangeError for an unknown repeat kind', () => {
    expect(() => wallPlan({ ...base, repeat: 'brick' as unknown as Repeat })).toThrow(RangeError);
  });
});
