import type { Lab, Rgb, Xyz } from './types';

const NI = 'not implemented';

export function hexToRgb(_hex: string): Rgb {
  throw new Error(NI, { cause: [_hex] });
}
export function rgbToHex(_rgb: Rgb): string {
  throw new Error(NI, { cause: [_rgb] });
}
export function srgbToLinear(_v: number): number {
  throw new Error(NI, { cause: [_v] });
}
export function linearToSrgb(_v: number): number {
  throw new Error(NI, { cause: [_v] });
}
export function linearRgbToXyz(_rgb: readonly [number, number, number]): Xyz {
  throw new Error(NI, { cause: [_rgb] });
}
export function xyzToLinearRgb(_xyz: Xyz): readonly [number, number, number] {
  throw new Error(NI, { cause: [_xyz] });
}
export function xyzToLab(_xyz: Xyz): Lab {
  throw new Error(NI, { cause: [_xyz] });
}
export function labToXyz(_lab: Lab): Xyz {
  throw new Error(NI, { cause: [_lab] });
}
export function rgbToLab(_rgb: Rgb): Lab {
  throw new Error(NI, { cause: [_rgb] });
}
export function labToRgb(_lab: Lab): Rgb {
  throw new Error(NI, { cause: [_lab] });
}
