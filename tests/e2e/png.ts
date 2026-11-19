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

export type ParsedPng = {
  width: number;
  height: number;
  chunks: Array<{ type: string; data: Buffer }>;
  /** tEXt chunks as keyword -> text (Latin-1). */
  text: Record<string, string>;
};

/** Minimal strict PNG reader for asserting on downloads: checks the signature and every chunk CRC. */
export function parsePng(bytes: Buffer): ParsedPng {
  if (!bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error('not a PNG: bad signature');
  }
  const chunks: ParsedPng['chunks'] = [];
  let at = 8;
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    const data = bytes.subarray(at + 8, at + 8 + length);
    const stored = bytes.readUInt32BE(at + 8 + length);
    if (crc32(bytes.subarray(at + 4, at + 8 + length)) !== stored) throw new Error(`bad CRC in ${type} chunk`);
    chunks.push({ type, data });
    at += 12 + length;
  }
  const ihdr = chunks[0];
  if (ihdr?.type !== 'IHDR') throw new Error('first chunk is not IHDR');
  const text: Record<string, string> = {};
  for (const c of chunks.filter((chunk) => chunk.type === 'tEXt')) {
    const nul = c.data.indexOf(0);
    text[c.data.toString('latin1', 0, nul)] = c.data.toString('latin1', nul + 1);
  }
  return { width: ihdr.data.readUInt32BE(0), height: ihdr.data.readUInt32BE(4), chunks, text };
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
