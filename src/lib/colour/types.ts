export type Rgb = readonly [number, number, number];
export type Lab = readonly [number, number, number];
export type Xyz = readonly [number, number, number];
export type Swatch = { hex: string; lab: Lab; share: number };
export type PixelBuffer = { data: Uint8ClampedArray; width: number; height: number };
