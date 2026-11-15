// CIEDE2000 colour difference (kL = kC = kH = 1), following Sharma, Wu and Dalal (2005), "The CIEDE2000
// Color-Difference Formula: Implementation Notes, Supplementary Test Data, and Mathematical Observations".
// Verified against that paper's 34 published test pairs (tests/fixtures/colour).
import type { Lab } from './types';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const POW25_7 = 25 ** 7;

function hueDegrees(b: number, aPrime: number): number {
  if (b === 0 && aPrime === 0) return 0;
  const h = Math.atan2(b, aPrime) * DEG;
  return h < 0 ? h + 360 : h;
}

/** a' (chroma-corrected a), C' and h' for one colour. */
function primed([, a, b]: Lab, g: number): { c: number; h: number } {
  const aPrime = (1 + g) * a;
  return { c: Math.hypot(aPrime, b), h: hueDegrees(b, aPrime) };
}

function chromaCorrection(c1: number, c2: number): number {
  const cBar7 = ((c1 + c2) / 2) ** 7;
  return 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + POW25_7)));
}

function hueDifference(h1: number, h2: number, chromaProduct: number): number {
  if (chromaProduct === 0) return 0;
  const d = h2 - h1;
  if (d > 180) return d - 360;
  if (d < -180) return d + 360;
  return d;
}

function meanHue(h1: number, h2: number, chromaProduct: number): number {
  if (chromaProduct === 0) return h1 + h2;
  const sum = h1 + h2;
  if (Math.abs(h1 - h2) <= 180) return sum / 2;
  return sum < 360 ? (sum + 360) / 2 : (sum - 360) / 2;
}

function hueWeight(hBar: number): number {
  return (
    1 -
    0.17 * Math.cos((hBar - 30) * RAD) +
    0.24 * Math.cos(2 * hBar * RAD) +
    0.32 * Math.cos((3 * hBar + 6) * RAD) -
    0.2 * Math.cos((4 * hBar - 63) * RAD)
  );
}

export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const [l1, a1, b1] = lab1;
  const [l2, a2, b2] = lab2;
  const g = chromaCorrection(Math.hypot(a1, b1), Math.hypot(a2, b2));
  const p1 = primed(lab1, g);
  const p2 = primed(lab2, g);
  const chromaProduct = p1.c * p2.c;

  const dL = l2 - l1;
  const dC = p2.c - p1.c;
  const dH = 2 * Math.sqrt(chromaProduct) * Math.sin((hueDifference(p1.h, p2.h, chromaProduct) * RAD) / 2);

  const lBar = (l1 + l2) / 2;
  const cBar = (p1.c + p2.c) / 2;
  const hBar = meanHue(p1.h, p2.h, chromaProduct);

  const sl = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sc = 1 + 0.045 * cBar;
  const sh = 1 + 0.015 * cBar * hueWeight(hBar);
  const cBar7 = cBar ** 7;
  const rc = 2 * Math.sqrt(cBar7 / (cBar7 + POW25_7));
  const dTheta = 30 * Math.exp(-(((hBar - 275) / 25) ** 2));
  const rt = -Math.sin(2 * dTheta * RAD) * rc;

  const termL = dL / sl;
  const termC = dC / sc;
  const termH = dH / sh;
  return Math.sqrt(termL ** 2 + termC ** 2 + termH ** 2 + rt * termC * termH);
}
