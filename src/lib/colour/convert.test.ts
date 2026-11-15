import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { loadLabOracle } from '../../../tests/helpers/colour';
import {
  hexToRgb,
  labToRgb,
  labToXyz,
  linearRgbToXyz,
  linearToSrgb,
  rgbToHex,
  rgbToLab,
  srgbToLinear,
  xyzToLab,
  xyzToLinearRgb,
} from './convert';
import type { Lab, Rgb, Xyz } from './types';

const PROP = { seed: 42, numRuns: 200 } as const;
const byte = fc.integer({ min: 0, max: 255 });
const rgbArb = fc.tuple(byte, byte, byte);

// The oracle's white point, from its chromaticity xy = (0.3127, 0.3290) and Y = 1 (definition of xy).
const WHITE_X = 0.3127 / 0.329;
const WHITE_Z = (1 - 0.3127 - 0.329) / 0.329;
// CIE constants as cited in tests/fixtures/colour/README.md (Lindbloom, XYZ to Lab).
const EPSILON = 216 / 24389;
const KAPPA = 24389 / 27;

function expectTupleClose(actual: readonly number[], expected: readonly number[], digits: number): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((e, i) => {
    expect(actual[i]).toBeCloseTo(e, digits);
  });
}

describe('hexToRgb', () => {
  it('parses an uppercase hex colour into 8-bit components', () => {
    expect(hexToRgb('#FF8000')).toEqual([255, 128, 0]);
  });

  it('parses hex case-insensitively', () => {
    expect(hexToRgb('#ff8000')).toEqual(hexToRgb('#FF8000'));
    expect(hexToRgb('#aBcDeF')).toEqual([0xab, 0xcd, 0xef]);
  });

  it('parses black and white', () => {
    expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
    expect(hexToRgb('#FFFFFF')).toEqual([255, 255, 255]);
  });

  it('keeps each component in its own position', () => {
    expect(hexToRgb('#010203')).toEqual([1, 2, 3]);
  });

  it.each([
    ['three-digit shorthand', '#FFF'],
    ['missing hash', 'FF8000'],
    ['empty string', ''],
    ['only a hash', '#'],
    ['five digits', '#FF800'],
    ['seven digits', '#FF80001'],
    ['non-hex letters', '#GG0000'],
    ['non-hex letter in last position', '#00000G'],
    ['leading whitespace', ' #FF8000'],
    ['trailing whitespace', '#FF8000 '],
    ['trailing newline', '#FF8000\n'],
    ['eight-digit alpha form', '#FF8000FF'],
    ['0x prefix', '0xFF8000'],
  ])('throws RangeError for %s', (_name, input) => {
    expect(() => hexToRgb(input)).toThrow(RangeError);
  });
});

describe('rgbToHex', () => {
  it('formats uppercase with a leading hash', () => {
    expect(rgbToHex([255, 128, 0])).toBe('#FF8000');
    expect(rgbToHex([171, 205, 239])).toBe('#ABCDEF');
  });

  it('zero-pads single digit components', () => {
    expect(rgbToHex([0, 0, 0])).toBe('#000000');
    expect(rgbToHex([1, 2, 3])).toBe('#010203');
    expect(rgbToHex([15, 16, 255])).toBe('#0F10FF');
  });

  it.each([
    ['negative red', [-1, 0, 0]],
    ['negative green', [0, -1, 0]],
    ['negative blue', [0, 0, -1]],
    ['red above 255', [256, 0, 0]],
    ['green above 255', [0, 256, 0]],
    ['blue above 255', [0, 0, 256]],
    ['fractional red', [1.5, 0, 0]],
    ['fractional green', [0, 1.5, 0]],
    ['fractional blue', [0, 0, 1.5]],
    ['NaN', [Number.NaN, 0, 0]],
    ['Infinity', [0, Number.POSITIVE_INFINITY, 0]],
  ] as [string, [number, number, number]][])('throws RangeError for %s', (_name, rgb) => {
    expect(() => rgbToHex(rgb)).toThrow(RangeError);
  });

  it('accepts the extremes 0 and 255 in every position', () => {
    expect(rgbToHex([255, 0, 255])).toBe('#FF00FF');
    expect(rgbToHex([0, 255, 0])).toBe('#00FF00');
  });

  it('round-trips with hexToRgb for any 8-bit colour', () => {
    fc.assert(
      fc.property(rgbArb, (rgb) => {
        expect(hexToRgb(rgbToHex(rgb))).toEqual(rgb);
      }),
      { seed: 42, numRuns: 500 },
    );
  });

  it('always produces the uppercase #RRGGBB shape', () => {
    fc.assert(
      fc.property(rgbArb, (rgb) => /^#[0-9A-F]{6}$/.test(rgbToHex(rgb))),
      PROP,
    );
  });
});

describe('sRGB companding', () => {
  it('maps the endpoints to themselves', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 12);
    expect(linearToSrgb(0)).toBe(0);
    expect(linearToSrgb(1)).toBeCloseTo(1, 12);
  });

  it('uses the linear segment at and below the 0.04045 threshold', () => {
    expect(srgbToLinear(0.04045)).toBeCloseTo(0.04045 / 12.92, 12);
    expect(srgbToLinear(0.02)).toBeCloseTo(0.02 / 12.92, 12);
  });

  it('uses the power segment above the 0.04045 threshold', () => {
    const v = 0.04046;
    expect(srgbToLinear(v)).toBeCloseTo(((v + 0.055) / 1.055) ** 2.4, 12);
    expect(srgbToLinear(0.5)).toBeCloseTo(((0.5 + 0.055) / 1.055) ** 2.4, 12);
  });

  it('uses the linear segment at and below the 0.0031308 threshold when encoding', () => {
    expect(linearToSrgb(0.0031308)).toBeCloseTo(12.92 * 0.0031308, 12);
    expect(linearToSrgb(0.001)).toBeCloseTo(12.92 * 0.001, 12);
  });

  it('uses the power segment above the 0.0031308 threshold when encoding', () => {
    const v = 0.0031309;
    expect(linearToSrgb(v)).toBeCloseTo(1.055 * v ** (1 / 2.4) - 0.055, 12);
    expect(linearToSrgb(0.5)).toBeCloseTo(1.055 * 0.5 ** (1 / 2.4) - 0.055, 12);
  });

  it('is continuous across both thresholds', () => {
    expect(Math.abs(srgbToLinear(0.04045 + 1e-9) - srgbToLinear(0.04045))).toBeLessThan(1e-7);
    expect(Math.abs(linearToSrgb(0.0031308 + 1e-9) - linearToSrgb(0.0031308))).toBeLessThan(1e-7);
  });

  it('round-trips srgb -> linear -> srgb for any value in 0..1', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (v) => {
        expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 8);
      }),
      { seed: 42, numRuns: 500 },
    );
  });

  it('round-trips linear -> srgb -> linear for any value in 0..1', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (v) => {
        expect(srgbToLinear(linearToSrgb(v))).toBeCloseTo(v, 8);
      }),
      { seed: 42, numRuns: 500 },
    );
  });

  it('is strictly increasing', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 0.98, noNaN: true }),
        fc.double({ min: 0.001, max: 0.01, noNaN: true }),
        (v, d) => {
          expect(srgbToLinear(v + d)).toBeGreaterThan(srgbToLinear(v));
          expect(linearToSrgb(v + d)).toBeGreaterThan(linearToSrgb(v));
        },
      ),
      PROP,
    );
  });
});

describe('linear RGB <-> XYZ', () => {
  it('maps black to XYZ zero', () => {
    expectTupleClose(linearRgbToXyz([0, 0, 0]), [0, 0, 0], 12);
  });

  it('maps linear white to the D65 white with Y = 1', () => {
    const xyz = linearRgbToXyz([1, 1, 1]);
    expect(xyz[0]).toBeCloseTo(WHITE_X, 3);
    expect(xyz[1]).toBeCloseTo(1, 4);
    expect(xyz[2]).toBeCloseTo(WHITE_Z, 3);
  });

  it('has Y contributions from the three primaries that sum to 1', () => {
    const y = linearRgbToXyz([1, 0, 0])[1] + linearRgbToXyz([0, 1, 0])[1] + linearRgbToXyz([0, 0, 1])[1];
    expect(y).toBeCloseTo(1, 4);
  });

  it('weights green most and blue least in luminance', () => {
    const yr = linearRgbToXyz([1, 0, 0])[1];
    const yg = linearRgbToXyz([0, 1, 0])[1];
    const yb = linearRgbToXyz([0, 0, 1])[1];
    expect(yg).toBeGreaterThan(yr);
    expect(yr).toBeGreaterThan(yb);
    expect(yb).toBeGreaterThan(0);
  });

  it('keeps greys on the white chromaticity', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.01, max: 1, noNaN: true }), (g) => {
        const [x, y, z] = linearRgbToXyz([g, g, g]);
        expect(y).toBeCloseTo(g, 4);
        expect(x / y).toBeCloseTo(WHITE_X, 3);
        expect(z / y).toBeCloseTo(WHITE_Z, 3);
      }),
      PROP,
    );
  });

  it('is linear: f(a + b) = f(a) + f(b)', () => {
    const unit = fc.double({ min: 0, max: 0.5, noNaN: true });
    fc.assert(
      fc.property(fc.tuple(unit, unit, unit), fc.tuple(unit, unit, unit), (a, b) => {
        const sum = linearRgbToXyz([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
        const fa = linearRgbToXyz(a);
        const fb = linearRgbToXyz(b);
        expectTupleClose(sum, [fa[0] + fb[0], fa[1] + fb[1], fa[2] + fb[2]], 9);
      }),
      PROP,
    );
  });

  it('round-trips linear RGB -> XYZ -> linear RGB', () => {
    const unit = fc.double({ min: 0, max: 1, noNaN: true });
    fc.assert(
      fc.property(fc.tuple(unit, unit, unit), (rgb) => {
        expectTupleClose(xyzToLinearRgb(linearRgbToXyz(rgb)), rgb, 6);
      }),
      PROP,
    );
  });

  it('round-trips XYZ -> linear RGB -> XYZ', () => {
    const c = fc.double({ min: 0, max: 1, noNaN: true });
    fc.assert(
      fc.property(fc.tuple(c, c, c), (xyz) => {
        expectTupleClose(linearRgbToXyz(xyzToLinearRgb(xyz)), xyz, 6);
      }),
      PROP,
    );
  });
});

describe('XYZ <-> Lab', () => {
  const white: Xyz = [WHITE_X, 1, WHITE_Z];

  it('maps the white point to L=100, a=0, b=0', () => {
    const [l, a, b] = xyzToLab(white);
    expect(Math.abs(l - 100)).toBeLessThan(0.01);
    expect(Math.abs(a)).toBeLessThan(0.01);
    expect(Math.abs(b)).toBeLessThan(0.01);
  });

  it('maps XYZ zero to Lab zero', () => {
    expectTupleClose(xyzToLab([0, 0, 0]), [0, 0, 0], 9);
  });

  it('follows L = 116 * cbrt(Y) - 16 just above the CIE epsilon', () => {
    const t = EPSILON * 1.01;
    const lab = xyzToLab([WHITE_X * t, t, WHITE_Z * t]);
    expect(lab[0]).toBeCloseTo(116 * Math.cbrt(t) - 16, 6);
    expect(lab[1]).toBeCloseTo(0, 6);
    expect(lab[2]).toBeCloseTo(0, 6);
  });

  it('follows L = kappa * Y just below the CIE epsilon', () => {
    const t = EPSILON * 0.99;
    const lab = xyzToLab([WHITE_X * t, t, WHITE_Z * t]);
    expect(lab[0]).toBeCloseTo(KAPPA * t, 6);
    expect(lab[1]).toBeCloseTo(0, 6);
    expect(lab[2]).toBeCloseTo(0, 6);
  });

  it('is continuous across the CIE epsilon for L', () => {
    const below = xyzToLab([WHITE_X * EPSILON * (1 - 1e-9), EPSILON * (1 - 1e-9), WHITE_Z * EPSILON * (1 - 1e-9)]);
    const above = xyzToLab([WHITE_X * EPSILON * (1 + 1e-9), EPSILON * (1 + 1e-9), WHITE_Z * EPSILON * (1 + 1e-9)]);
    expect(Math.abs(above[0] - below[0])).toBeLessThan(1e-5);
  });

  it('gives positive a when X is high relative to Y, and positive b when Z is low', () => {
    const [, aHighX, bLowZ] = xyzToLab([WHITE_X * 0.8, 0.5, WHITE_Z * 0.2]);
    expect(aHighX).toBeGreaterThan(0);
    expect(bLowZ).toBeGreaterThan(0);
    const [, aLowX, bHighZ] = xyzToLab([WHITE_X * 0.2, 0.5, WHITE_Z * 0.8]);
    expect(aLowX).toBeLessThan(0);
    expect(bHighZ).toBeLessThan(0);
  });

  it('round-trips XYZ -> Lab -> XYZ across both CIE branches', () => {
    const c = fc.double({ min: 0, max: 1.2, noNaN: true });
    fc.assert(
      fc.property(fc.tuple(c, c, c), (xyz) => {
        expectTupleClose(labToXyz(xyzToLab(xyz)), xyz, 6);
      }),
      { seed: 42, numRuns: 500 },
    );
  });

  it('round-trips tiny XYZ values (low branch)', () => {
    const c = fc.double({ min: 0, max: 0.01, noNaN: true });
    fc.assert(
      fc.property(fc.tuple(c, c, c), (xyz) => {
        expectTupleClose(labToXyz(xyzToLab(xyz)), xyz, 8);
      }),
      PROP,
    );
  });

  it('round-trips Lab -> XYZ -> Lab', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 100, noNaN: true }),
        fc.double({ min: -60, max: 60, noNaN: true }),
        fc.double({ min: -60, max: 60, noNaN: true }),
        (l, a, b) => {
          expectTupleClose(xyzToLab(labToXyz([l, a, b])), [l, a, b], 6);
        },
      ),
      { seed: 42, numRuns: 500 },
    );
  });

  it('maps Lab L=0 to Y=0', () => {
    expect(labToXyz([0, 0, 0])[1]).toBeCloseTo(0, 12);
  });

  it('maps Lab L=100, a=0, b=0 to the white point', () => {
    expectTupleClose(labToXyz([100, 0, 0]), white, 3);
  });
});

describe('rgbToLab against the colour-science oracle', () => {
  const oracle = loadLabOracle();

  it('loads all 43 oracle entries', () => {
    expect(oracle).toHaveLength(43);
  });

  it.each(oracle.map((entry) => [entry.name, entry] as const))(
    'matches the oracle within 0.01 per component for %s',
    (_name, entry) => {
      const lab = rgbToLab(entry.rgb);
      for (let i = 0; i < 3; i++) {
        expect(Math.abs((lab[i] ?? Number.NaN) - (entry.lab[i] ?? Number.NaN))).toBeLessThanOrEqual(0.01);
      }
    },
  );

  it('maps white to L=100, a=0, b=0 within 0.01', () => {
    const [l, a, b] = rgbToLab([255, 255, 255]);
    expect(Math.abs(l - 100)).toBeLessThan(0.01);
    expect(Math.abs(a)).toBeLessThan(0.01);
    expect(Math.abs(b)).toBeLessThan(0.01);
  });

  it('maps black to exactly L=0, a=0, b=0', () => {
    expectTupleClose(rgbToLab([0, 0, 0]), [0, 0, 0], 9);
  });

  it('keeps every grey on the neutral axis with L increasing', () => {
    let previous = -1;
    for (let g = 0; g <= 255; g++) {
      const [l, a, b] = rgbToLab([g, g, g]);
      expect(Math.abs(a)).toBeLessThan(0.01);
      expect(Math.abs(b)).toBeLessThan(0.01);
      expect(l).toBeGreaterThan(previous);
      previous = l;
    }
  });

  it('keeps L within 0..100 for any 8-bit colour', () => {
    fc.assert(
      fc.property(rgbArb, (rgb) => {
        const [l] = rgbToLab(rgb);
        expect(l).toBeGreaterThanOrEqual(0);
        expect(l).toBeLessThanOrEqual(100.01);
      }),
      PROP,
    );
  });
});

describe('labToRgb', () => {
  it('returns the oracle sRGB for every oracle Lab', () => {
    for (const entry of loadLabOracle()) {
      expect(labToRgb(entry.lab)).toEqual(entry.rgb);
    }
  });

  it('round-trips rgb -> Lab -> rgb for any 8-bit colour', () => {
    fc.assert(
      fc.property(rgbArb, (rgb) => {
        expect(labToRgb(rgbToLab(rgb))).toEqual(rgb);
      }),
      { seed: 42, numRuns: 2000 },
    );
  });

  it('round-trips every grey and every single-channel ramp exactly', () => {
    for (let v = 0; v <= 255; v++) {
      const ramps: Rgb[] = [
        [v, v, v],
        [v, 0, 0],
        [0, v, 0],
        [0, 0, v],
      ];
      for (const rgb of ramps) {
        expect(labToRgb(rgbToLab(rgb))).toEqual(rgb);
      }
    }
  });

  it('rounds to the nearest integer rather than truncating', () => {
    // A tiny nudge in Lab either way must still land on the same 8-bit colour.
    const rgb: Rgb = [200, 100, 50];
    const [l, a, b] = rgbToLab(rgb);
    expect(labToRgb([l + 0.001, a, b])).toEqual(rgb);
    expect(labToRgb([l - 0.001, a, b])).toEqual(rgb);
  });

  it('clamps over-bright greys to 255', () => {
    expect(labToRgb([150, 0, 0])).toEqual([255, 255, 255]);
  });

  it('clamps negative lightness to 0', () => {
    expect(labToRgb([-20, 0, 0])).toEqual([0, 0, 0]);
  });

  it('clamps an out-of-gamut green to 0 in the red channel', () => {
    const rgb = labToRgb([50, -120, 50]);
    expect(rgb[0]).toBe(0);
    expect(rgb[1]).toBeGreaterThan(0);
  });

  it('returns integers within 0..255 for any Lab, including far outside the gamut', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -50, max: 150, noNaN: true }),
        fc.double({ min: -200, max: 200, noNaN: true }),
        fc.double({ min: -200, max: 200, noNaN: true }),
        (l, a, b) => {
          const out: Lab = labToRgb([l, a, b]);
          for (const c of out) {
            expect(Number.isInteger(c)).toBe(true);
            expect(c).toBeGreaterThanOrEqual(0);
            expect(c).toBeLessThanOrEqual(255);
          }
        },
      ),
      { seed: 42, numRuns: 500 },
    );
  });
});
