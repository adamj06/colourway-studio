import { crc32, deflateSync } from 'node:zlib';

// A tiny PNG encoder for e2e fixtures, so tests can serve an image whose palette is known exactly.
// PNG is lossless, unlike the JPEG the real IIIF server sends, so the colours survive to the pixel.

export type RgbTriple = readonly [number, number, number];

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

export function hexToTriple(hex: string): RgbTriple {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function encodePng(width: number, height: number, pick: (x: number, y: number) => RgbTriple): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit, RGB, deflate, no filter pre-processing, no interlace

  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter type: none
    for (let x = 0; x < width; x++) raw.set(pick(x, y), y * stride + 1 + x * 3);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Even-sized checkerboard of two colours: its palette is exactly those two colours at 50% each. */
export function checkerboardPng(hexA: string, hexB: string, size = 64): Buffer {
  const a = hexToTriple(hexA);
  const b = hexToTriple(hexB);
  return encodePng(size, size, (x, y) => ((x + y) % 2 === 0 ? a : b));
}

/** Equal vertical bands, one per colour: its palette is exactly those colours at an equal share each. */
export function bandsPng(hexes: readonly string[], bandWidth = 20, height = 100): Buffer {
  const colours = hexes.map(hexToTriple);
  return encodePng(bandWidth * colours.length, height, (x) => colours[Math.floor(x / bandWidth)] ?? colours[0]!);
}
