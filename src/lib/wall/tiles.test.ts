import { describe, expect, it } from 'vitest';
import { DEFAULT_REPEATS, MAX_REPEATS, MIN_REPEATS, layoutTiles, tileSize, type Rect, type Repeat } from './tiles';

const base = { wallW: 400, wallH: 300, tileW: 100, tileH: 100 };

const covered = (rects: Rect[], px: number, py: number) =>
  rects.some((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);

/** A point is strictly covered if it is inside the half-open pixel rect [x, x+w). */
const coveredHalfOpen = (rects: Rect[], px: number, py: number) =>
  rects.some((r) => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h);

const sampleXs = (w: number) => {
  const out: number[] = [0, 0.5, w / 2, w - 1, w - 0.5, w - 0.001];
  for (let i = 0; i <= 40; i++) out.push((w * i) / 40 - (i === 40 ? 0.001 : 0));
  return out.filter((v) => v >= 0 && v < w);
};

describe('constants', () => {
  it('exposes the repeat slider bounds and default', () => {
    expect(MIN_REPEATS).toBe(2);
    expect(MAX_REPEATS).toBe(10);
    expect(DEFAULT_REPEATS).toBe(4);
  });
});

describe('layoutTiles straight', () => {
  it('starts the first tile at the origin', () => {
    const rects = layoutTiles({ ...base, repeat: 'straight' });
    expect(rects).toContainEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it('lays out an exact fit as 12 tiles that stay within the wall', () => {
    const rects = layoutTiles({ ...base, repeat: 'straight' });
    expect(rects).toHaveLength(12);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(400);
      expect(r.y + r.h).toBeLessThanOrEqual(300);
    }
  });

  it('steps columns by the tile width and rows by the tile height', () => {
    const rects = layoutTiles({ ...base, repeat: 'straight' });
    expect([...new Set(rects.map((r) => r.x))].sort((a, b) => a - b)).toEqual([0, 100, 200, 300]);
    expect([...new Set(rects.map((r) => r.y))].sort((a, b) => a - b)).toEqual([0, 100, 200]);
  });

  it('gives every tile the requested size', () => {
    for (const r of layoutTiles({ ...base, repeat: 'straight' })) {
      expect(r.w).toBe(100);
      expect(r.h).toBe(100);
    }
  });

  it('counts ceil(wall/tile) in each direction', () => {
    const rects = layoutTiles({
      wallW: 1000,
      wallH: 600,
      tileW: 230,
      tileH: 170,
      repeat: 'straight',
    });
    expect(rects).toHaveLength(Math.ceil(1000 / 230) * Math.ceil(600 / 170));
  });

  it('needs only one tile when the tile is bigger than the wall', () => {
    const rects = layoutTiles({
      wallW: 100,
      wallH: 80,
      tileW: 500,
      tileH: 400,
      repeat: 'straight',
    });
    expect(rects).toEqual([{ x: 0, y: 0, w: 500, h: 400 }]);
  });
});

describe('layoutTiles half-drop', () => {
  const rects = layoutTiles({ ...base, repeat: 'half-drop' });
  const col = (x: number) => rects.filter((r) => r.x === x).sort((a, b) => a.y - b.y);

  it('keeps even columns identical to straight', () => {
    const straight = layoutTiles({ ...base, repeat: 'straight' });
    for (const x of [0, 200]) {
      expect(col(x)).toEqual(straight.filter((r) => r.x === x).sort((a, b) => a.y - b.y));
    }
  });

  it('shifts odd columns down by half a tile height', () => {
    for (const x of [100, 300]) {
      const ys = col(x).map((r) => r.y);
      expect(ys).toContain(50);
      expect(ys).not.toContain(0);
      expect(ys).toContain(250);
    }
  });

  it('adds an extra tile starting at minus half a tile height to odd columns', () => {
    for (const x of [100, 300]) {
      expect(col(x)[0]).toEqual({ x, y: -50, w: 100, h: 100 });
    }
    expect(col(0)[0]?.y).toBe(0);
  });

  it('gives every tile the requested size', () => {
    for (const r of rects) {
      expect(r.w).toBe(100);
      expect(r.h).toBe(100);
    }
  });

  it('puts the extra top tile only in odd columns', () => {
    expect(
      rects
        .filter((r) => r.y < 0)
        .map((r) => r.x)
        .sort((a, b) => a - b),
    ).toEqual([100, 300]);
  });
});

describe('layoutTiles coverage', () => {
  const cases: Array<[string, number, number, number, number]> = [
    ['exact fit', 400, 300, 100, 100],
    ['non-integer ratio', 1000, 600, 230, 170],
    ['tile wider and taller than the wall', 100, 80, 500, 400],
    ['tile as wide as the wall', 300, 500, 300, 120],
    ['tiny fractional tile', 97, 61, 7.3, 5.9],
    ['single pixel wall', 1, 1, 10, 10],
  ];

  describe.each(['straight', 'half-drop'] as Repeat[])('%s', (repeat) => {
    it.each(cases)('covers the whole wall: %s', (_name, wallW, wallH, tileW, tileH) => {
      const rects = layoutTiles({ wallW, wallH, tileW, tileH, repeat });
      for (const px of sampleXs(wallW)) {
        for (const py of sampleXs(wallH)) {
          expect(coveredHalfOpen(rects, px, py), `point ${String(px)},${String(py)}`).toBe(true);
        }
      }
      // corners, closed
      expect(covered(rects, 0, 0)).toBe(true);
      expect(covered(rects, wallW, wallH)).toBe(true);
    });

    it.each(cases)('has no tile entirely off the wall: %s', (_name, wallW, wallH, tileW, tileH) => {
      const rects = layoutTiles({ wallW, wallH, tileW, tileH, repeat });
      for (const r of rects) {
        const ox = Math.min(r.x + r.w, wallW) - Math.max(r.x, 0);
        const oy = Math.min(r.y + r.h, wallH) - Math.max(r.y, 0);
        expect(ox).toBeGreaterThan(0);
        expect(oy).toBeGreaterThan(0);
      }
    });
  });

  it('covers the bottom-right pixel for half-drop with an odd column count', () => {
    const rects = layoutTiles({
      wallW: 1000,
      wallH: 600,
      tileW: 230,
      tileH: 170,
      repeat: 'half-drop',
    });
    expect(coveredHalfOpen(rects, 999, 599)).toBe(true);
  });
});

describe('layoutTiles validation', () => {
  it.each([
    ['wallW', { wallW: 0 }],
    ['wallW negative', { wallW: -1 }],
    ['wallH', { wallH: 0 }],
    ['wallH negative', { wallH: -1 }],
    ['tileW', { tileW: 0 }],
    ['tileW negative', { tileW: -5 }],
    ['tileH', { tileH: 0 }],
    ['tileH negative', { tileH: -5 }],
    ['wallW NaN', { wallW: Number.NaN }],
    ['wallH NaN', { wallH: Number.NaN }],
    ['tileW NaN', { tileW: Number.NaN }],
    ['tileH NaN', { tileH: Number.NaN }],
    ['wallW infinite', { wallW: Infinity }],
    ['wallH infinite', { wallH: Infinity }],
    ['tileW infinite', { tileW: Infinity }],
    ['tileH infinite', { tileH: Infinity }],
  ])('rejects bad %s', (_name, override) => {
    expect(() => layoutTiles({ ...base, repeat: 'straight', ...override })).toThrow(RangeError);
  });

  it('rejects an unknown repeat value', () => {
    expect(() => layoutTiles({ ...base, repeat: 'brick' as unknown as Repeat })).toThrow(RangeError);
  });
});

describe('tileSize', () => {
  it('divides the wall width by the repeats and keeps the region aspect', () => {
    expect(tileSize({ wallW: 1200, repeats: 4, regionW: 800, regionH: 600 })).toEqual({
      w: 300,
      h: 225,
    });
  });

  it('handles a portrait region', () => {
    expect(tileSize({ wallW: 1000, repeats: 5, regionW: 300, regionH: 600 })).toEqual({
      w: 200,
      h: 400,
    });
  });

  it('rounds to whole pixels', () => {
    const s = tileSize({ wallW: 1000, repeats: 3, regionW: 100, regionH: 100 });
    expect(s).toEqual({ w: 333, h: 333 });
  });

  it('keeps a very thin tile at least 1 pixel high', () => {
    const s = tileSize({ wallW: 1000, repeats: 10, regionW: 10_000, regionH: 1 });
    expect(s.w).toBe(100);
    expect(s.h).toBe(1);
  });

  it('keeps a very narrow wall at least 1 pixel wide', () => {
    const s = tileSize({ wallW: 5, repeats: 10, regionW: 100, regionH: 100 });
    expect(s.w).toBe(1);
    expect(s.h).toBeGreaterThanOrEqual(1);
  });

  it.each([MIN_REPEATS, 3, DEFAULT_REPEATS, MAX_REPEATS])('accepts %s repeats', (repeats) => {
    const s = tileSize({ wallW: 1000, repeats, regionW: 100, regionH: 100 });
    expect(s.w).toBe(Math.round(1000 / repeats));
  });

  it.each([1, 0, -4, 11, 4.5, Number.NaN, Infinity])('rejects %s repeats', (repeats) => {
    expect(() => tileSize({ wallW: 1200, repeats, regionW: 800, regionH: 600 })).toThrow(RangeError);
  });

  it.each([
    [0, 600],
    [800, 0],
    [-1, 600],
    [800, -1],
    [Number.NaN, 600],
    [800, Number.NaN],
  ])('rejects region %s by %s', (regionW, regionH) => {
    expect(() => tileSize({ wallW: 1200, repeats: 4, regionW, regionH })).toThrow(RangeError);
  });

  it.each([0, -10, Number.NaN])('rejects wall width %s', (wallW) => {
    expect(() => tileSize({ wallW, repeats: 4, regionW: 800, regionH: 600 })).toThrow(RangeError);
  });
});
