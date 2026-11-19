// PNG tEXt chunks, pure byte work. Errors are thrown (not returned) for a non-PNG input or an invalid keyword/text.
export type TextEntry = { readonly keyword: string; readonly text: string };

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const HEADER = SIGNATURE.length;
const CHUNK_OVERHEAD = 12; // length (4) + type (4) + crc (4)
const MAX_KEYWORD = 79;

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function latin1(value: string, label: string): Uint8Array {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code > 0xff || code === 0) throw new Error(`${label} must be Latin-1 and contain no NUL`);
    out[i] = code;
  }
  return out;
}

function keywordBytes(keyword: string): Uint8Array {
  const bytes = latin1(keyword, 'keyword');
  if (bytes.length < 1 || bytes.length > MAX_KEYWORD) throw new Error('keyword must be 1 to 79 bytes');
  if (keyword.startsWith(' ') || keyword.endsWith(' ')) throw new Error('keyword must not start or end with a space');
  return bytes;
}

function textChunk(entry: TextEntry): Uint8Array {
  const keyword = keywordBytes(entry.keyword);
  const text = latin1(entry.text, 'text');
  const dataLength = keyword.length + 1 + text.length;
  const chunk = new Uint8Array(CHUNK_OVERHEAD + dataLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, dataLength);
  chunk.set([0x74, 0x45, 0x58, 0x74], 4); // "tEXt"
  chunk.set(keyword, 8);
  chunk.set(text, 8 + keyword.length + 1);
  view.setUint32(8 + dataLength, crc32(chunk.subarray(4, 8 + dataLength)));
  return chunk;
}

type Located = { type: string; start: number; end: number; dataStart: number; dataEnd: number };

function typeAt(png: Uint8Array, offset: number): string {
  return String.fromCharCode(...png.subarray(offset + 4, offset + 8));
}

/** Walks the chunk list. Throws when the signature is wrong or a chunk runs past the end. */
function locate(png: Uint8Array): Located[] {
  if (png.length < HEADER || SIGNATURE.some((byte, i) => png[i] !== byte)) throw new Error('not a PNG');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: Located[] = [];
  let offset = HEADER;
  while (offset < png.length) {
    if (offset + CHUNK_OVERHEAD > png.length) throw new Error('truncated PNG');
    const length = view.getUint32(offset);
    const end = offset + CHUNK_OVERHEAD + length;
    if (end > png.length) throw new Error('truncated PNG');
    chunks.push({ type: typeAt(png, offset), start: offset, end, dataStart: offset + 8, dataEnd: offset + 8 + length });
    offset = end;
  }
  if (chunks[0]?.type !== 'IHDR') throw new Error('PNG has no IHDR');
  return chunks;
}

/** Returns a copy of the PNG with the entries as tEXt chunks right after IHDR. The input is not modified. */
export function insertTextChunks(png: Uint8Array, entries: readonly TextEntry[]): Uint8Array<ArrayBuffer> {
  const ihdr = locate(png)[0];
  if (!ihdr) throw new Error('PNG has no IHDR');
  const added = entries.map(textChunk);
  const total = added.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(png.length + total);
  out.set(png.subarray(0, ihdr.end), 0);
  let offset = ihdr.end;
  for (const chunk of added) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  out.set(png.subarray(ihdr.end), offset);
  return out;
}

export function readTextChunks(png: Uint8Array): TextEntry[] {
  const entries: TextEntry[] = [];
  for (const chunk of locate(png)) {
    if (chunk.type !== 'tEXt') continue;
    const data = png.subarray(chunk.dataStart, chunk.dataEnd);
    const split = data.indexOf(0);
    if (split < 1) continue;
    const decode = (bytes: Uint8Array) => String.fromCharCode(...bytes);
    entries.push({ keyword: decode(data.subarray(0, split)), text: decode(data.subarray(split + 1)) });
  }
  return entries;
}
