// sRGB <-> linear RGB <-> XYZ (D65) <-> CIELAB. Pure functions, no DOM.
//
// Formulas: sRGB companding and XYZ->Lab from Bruce Lindbloom's equation pages (links in
// tests/fixtures/colour/README.md), with epsilon = 216/24389 and kappa = 24389/27 (the intent of the CIE standard).
//
// RGB->XYZ uses the sRGB matrix to the 4 decimals the sRGB standard (IEC 61966-2-1) publishes, with the D65 white
// from the CIE chromaticity (0.3127, 0.3290). Those are exactly the constants the independent oracle
// (colour-science 0.4.7) uses, so results match it within 0.01. A matrix with more digits (Lindbloom's 7-digit one,
// or one derived from the primaries) differs from the oracle by up to 0.022 in Lab: see the README, "Known difference".
import type { Lab, Rgb, Xyz } from './types';

type Vec3 = readonly [number, number, number];
type Mat3 = readonly [Vec3, Vec3, Vec3];

const D65_XY = [0.3127, 0.329] as const;
const RGB_TO_XYZ: Mat3 = [
  [0.4124, 0.3576, 0.1805],
  [0.2126, 0.7152, 0.0722],
  [0.0193, 0.1192, 0.9505],
];

const EPSILON = 216 / 24389;
const KAPPA = 24389 / 27;

function xyToXyz(x: number, y: number): Vec3 {
  return [x / y, 1, (1 - x - y) / y];
}

function invert([[a, b, c], [d, e, f], [g, h, i]]: Mat3): Mat3 {
  const co1 = e * i - f * h;
  const co2 = -(d * i - f * g);
  const co3 = d * h - e * g;
  const det = a * co1 + b * co2 + c * co3;
  return [
    [co1 / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [co2 / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [co3 / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

function multiply([r0, r1, r2]: Mat3, [x, y, z]: Vec3): Vec3 {
  return [r0[0] * x + r0[1] * y + r0[2] * z, r1[0] * x + r1[1] * y + r1[2] * z, r2[0] * x + r2[1] * y + r2[2] * z];
}

const WHITE: Vec3 = xyToXyz(D65_XY[0], D65_XY[1]);
const XYZ_TO_RGB = invert(RGB_TO_XYZ);

const HEX = /^#[0-9a-fA-F]{6}$/;

export function hexToRgb(hex: string): Rgb {
  if (!HEX.test(hex)) throw new RangeError(`Not a #RRGGBB colour: ${hex}`);
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function hexByte(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new RangeError(`RGB components must be integers from 0 to 255, got ${String(value)}`);
  }
  return value.toString(16).padStart(2, '0');
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`.toUpperCase();
}

/** sRGB companded value (0..1) to linear light. */
export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Linear light (0..1) to sRGB companded value. */
export function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

export function linearRgbToXyz(rgb: Vec3): Xyz {
  return multiply(RGB_TO_XYZ, rgb);
}

export function xyzToLinearRgb(xyz: Xyz): Vec3 {
  return multiply(XYZ_TO_RGB, xyz);
}

function labF(t: number): number {
  return t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
}

export function xyzToLab([x, y, z]: Xyz): Lab {
  const fx = labF(x / WHITE[0]);
  const fy = labF(y / WHITE[1]);
  const fz = labF(z / WHITE[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labFInverse(f: number): number {
  const cubed = f ** 3;
  return cubed > EPSILON ? cubed : (116 * f - 16) / KAPPA;
}

export function labToXyz([l, a, b]: Lab): Xyz {
  const fy = (l + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const yr = l > KAPPA * EPSILON ? fy ** 3 : l / KAPPA;
  return [labFInverse(fx) * WHITE[0], yr * WHITE[1], labFInverse(fz) * WHITE[2]];
}

export function rgbToLab([r, g, b]: Rgb): Lab {
  return xyzToLab(linearRgbToXyz([srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255)]));
}

function toByte(linear: number): number {
  return Math.min(255, Math.max(0, Math.round(linearToSrgb(Math.min(1, Math.max(0, linear))) * 255)));
}

/** Rounds and clamps to the sRGB gamut, so out-of-gamut Labs map to the nearest in-range channel values. */
export function labToRgb(lab: Lab): Rgb {
  const [r, g, b] = xyzToLinearRgb(labToXyz(lab));
  return [toByte(r), toByte(g), toByte(b)];
}
