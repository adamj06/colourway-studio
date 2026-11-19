// Feature 005 (export): expects `src/lib/png/text-chunk.ts` to export
//   insertTextChunks(png: Uint8Array, entries: ReadonlyArray<{ keyword: string; text: string }>): Uint8Array
//   readTextChunks(png: Uint8Array): Array<{ keyword: string; text: string }>
// Error contract chosen for these tests: both functions THROW an Error (they do not return a typed error value) when
// the input is not a PNG (bad signature) or a keyword/text is invalid. They never mutate the input array.
//
// Reference data (not typed from memory, see tests/fixtures/png/README.md):
//  - tests/fixtures/png/minimal-3x2.png: built by tests/fixtures/png/make-minimal-png.py, Python 3.11.6 (zlib 1.2.13),
//    run as `python -I tests/fixtures/png/make-minimal-png.py tests/fixtures/png/minimal-3x2.png`.
//  - CRC-32 vectors printed by the same script (`zlib.crc32`): crc32(b'123456789') = 0xCBF43926,
//    crc32(b'IEND') = 0xAE426082, crc32(b'tEXtSoftware\x00Colourway Studio') = 0x0AEC6A97, and the full encoded
//    chunk for Source=Victoria and Albert Museum, London (O78207) is EXPECTED_SOURCE_CHUNK below.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { insertTextChunks, readTextChunks } from './text-chunk';

const fixture = new Uint8Array(
  readFileSync(path.join(import.meta.dirname, '../../../tests/fixtures/png/minimal-3x2.png')),
);

// An Error whose message is not the placeholder stub's, so the throws-tests cannot pass against a stub.
const REAL_ERROR = /^(?!not implemented$)/;
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR_END = 8 + 4 + 4 + 13 + 4; // signature + length + type + data + crc = 33

// Python: chunk(b'tEXt', b'Source\x00Victoria and Albert Museum, London (O78207)') as hex
const EXPECTED_SOURCE_CHUNK =
  '0000003274455874536f7572636500566963746f72696120616e6420416c62657274204d757365756d2c204c6f6e646f6e20284f373832303729889f2081';
const SOURCE = { keyword: 'Source', text: 'Victoria and Albert Museum, London (O78207)' };
const SOFTWARE = { keyword: 'Software', text: 'Colourway Studio' };

type Chunk = { type: string; data: Uint8Array; raw: Uint8Array; crc: number };

/** Independent minimal PNG chunk walker, so the tests do not depend on the code under test to read bytes. */
function chunks(png: Uint8Array): Chunk[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: Chunk[] = [];
  let at = 8;
  while (at < png.length) {
    const length = view.getUint32(at);
    out.push({
      type: String.fromCharCode(...png.subarray(at + 4, at + 8)),
      data: png.subarray(at + 8, at + 8 + length),
      raw: png.subarray(at, at + 12 + length),
      crc: view.getUint32(at + 8 + length),
    });
    at += 12 + length;
  }
  expect(at, 'chunks tile the file exactly').toBe(png.length);
  return out;
}

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const types = (png: Uint8Array): string[] => chunks(png).map((c) => c.type);
const withReferenceChunk = (): Uint8Array =>
  new Uint8Array([
    ...fixture.subarray(0, IHDR_END),
    ...Buffer.from(EXPECTED_SOURCE_CHUNK, 'hex'),
    ...fixture.subarray(IHDR_END),
  ]);

describe('reference data sanity (guards the oracle, not the code under test)', () => {
  it('the fixture is a 78-byte PNG with IHDR, IDAT, IEND in that order', () => {
    expect(fixture).toHaveLength(78);
    expect([...fixture.subarray(0, 8)]).toEqual(SIGNATURE);
    expect(types(fixture)).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('the CRC-32 check value for "123456789" is 0xCBF43926 and the fixture IEND CRC is 0xAE426082', () => {
    expect(crc32('123456789')).toBe(0xcbf43926);
    expect(chunks(fixture)[2]?.crc).toBe(0xae426082);
  });

  it('the reference tEXt chunk is itself a valid chunk', () => {
    const text = chunks(withReferenceChunk()).find((c) => c.type === 'tEXt');
    expect(text && crc32(text.raw.subarray(4, text.raw.length - 4))).toBe(text?.crc);
  });
});

describe('insertTextChunks', () => {
  it('produces exactly the bytes of an independently built tEXt chunk, right after IHDR', () => {
    expect(hex(insertTextChunks(fixture, [SOURCE]))).toBe(hex(withReferenceChunk()));
  });

  it('writes the CRC-32 over type and data, matching the reference 0x0AEC6A97 for Software=Colourway Studio', () => {
    const out = insertTextChunks(fixture, [SOFTWARE]);
    const text = chunks(out).find((c) => c.type === 'tEXt');
    expect(text?.crc).toBe(0x0aec6a97);
    expect(text?.data.length).toBe('Software'.length + 1 + 'Colourway Studio'.length);
  });

  it('gives every chunk a valid CRC after inserting several entries', () => {
    const out = insertTextChunks(fixture, [SOURCE, SOFTWARE]);
    for (const c of chunks(out)) {
      expect(crc32(c.raw.subarray(4, c.raw.length - 4)), c.type).toBe(c.crc);
    }
  });

  it('places the entries between IHDR and IDAT, in the order given', () => {
    const out = insertTextChunks(fixture, [SOURCE, SOFTWARE]);
    expect(types(out)).toEqual(['IHDR', 'tEXt', 'tEXt', 'IDAT', 'IEND']);
    expect(readTextChunks(out).map((e) => e.keyword)).toEqual(['Source', 'Software']);
  });

  it('keeps the original IHDR, IDAT and IEND chunks byte-for-byte and in order, and the signature', () => {
    const out = insertTextChunks(fixture, [SOURCE]);
    expect([...out.subarray(0, 8)]).toEqual(SIGNATURE);
    const before = chunks(fixture).map((c) => hex(c.raw));
    const after = chunks(out)
      .filter((c) => c.type !== 'tEXt')
      .map((c) => hex(c.raw));
    expect(after).toEqual(before);
  });

  it('grows the file by exactly 12 + keyword + 1 + text bytes per entry', () => {
    const out = insertTextChunks(fixture, [SOURCE, { keyword: 'A', text: '' }]);
    expect(out.length).toBe(fixture.length + (12 + 6 + 1 + SOURCE.text.length) + (12 + 1 + 1));
  });

  it('returns the same bytes when there are no entries', () => {
    expect(hex(insertTextChunks(fixture, []))).toBe(hex(fixture));
  });

  it('does not modify the input array', () => {
    const copy = new Uint8Array(fixture);
    insertTextChunks(fixture, [SOURCE]);
    expect(hex(fixture)).toBe(hex(copy));
  });

  it('round-trips entries through readTextChunks, including an empty text and spaces inside a keyword', () => {
    const entries = [{ keyword: 'Creation Time', text: '2026-11-18' }, { keyword: 'Empty', text: '' }, SOURCE];
    expect(readTextChunks(insertTextChunks(fixture, entries))).toEqual(entries);
  });

  it('encodes Latin-1 text as single bytes (e-acute is 0xE9) and round-trips it', () => {
    const out = insertTextChunks(fixture, [{ keyword: 'Title', text: 'Café' }]);
    const data = chunks(out).find((c) => c.type === 'tEXt')?.data ?? new Uint8Array(0);
    expect([...data.subarray(6)]).toEqual([0x43, 0x61, 0x66, 0xe9]);
    expect(readTextChunks(out)).toEqual([{ keyword: 'Title', text: 'Café' }]);
  });

  it('can be applied to its own output, keeping IHDR first and IDAT, IEND last', () => {
    const twice = insertTextChunks(insertTextChunks(fixture, [SOURCE]), [SOFTWARE]);
    expect(types(twice)).toEqual(['IHDR', 'tEXt', 'tEXt', 'IDAT', 'IEND']);
    expect(
      readTextChunks(twice)
        .map((e) => e.keyword)
        .sort(),
    ).toEqual(['Software', 'Source']);
  });

  describe('throws an Error on input that is not a PNG', () => {
    it.each([
      ['an empty array', new Uint8Array(0)],
      ['fewer than 8 bytes', new Uint8Array(SIGNATURE.slice(0, 5))],
      ['a bad signature (JPEG magic)', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...fixture.subarray(4)])],
      ['a signature with one wrong byte', new Uint8Array([...fixture.subarray(0, 7), 0x0b, ...fixture.subarray(8)])],
      ['plain text', new TextEncoder().encode('not a png at all, just text')],
      ['a signature with no IHDR after it', new Uint8Array(SIGNATURE)],
    ])('%s', (_name, bytes) => {
      expect(() => insertTextChunks(bytes, [SOURCE])).toThrow(REAL_ERROR);
    });
  });

  describe('throws an Error on an invalid keyword', () => {
    const attempt = (keyword: string) => () => insertTextChunks(fixture, [{ keyword, text: 'x' }]);

    it.each([
      ['empty', ''],
      ['80 bytes long', 'K'.repeat(80)],
      ['non-Latin-1 (CJK)', '色'],
      ['non-Latin-1 (emoji)', '\u{1F3A8}'],
      ['with a leading space', ' Source'],
      ['with a trailing space', 'Source '],
      ['containing a NUL', 'So\u0000urce'],
    ])('%s', (_name, keyword) => {
      expect(attempt(keyword)).toThrow(REAL_ERROR);
    });

    it('accepts a 79-byte keyword and a Latin-1 keyword', () => {
      expect(attempt('K'.repeat(79))).not.toThrow();
      expect(attempt('Café')).not.toThrow();
    });

    it('rejects the whole call if any one entry is bad', () => {
      expect(() => insertTextChunks(fixture, [SOURCE, { keyword: '', text: 'x' }])).toThrow(REAL_ERROR);
    });
  });

  it('throws an Error for text that cannot be written as Latin-1 (curly quote) or that contains NUL', () => {
    expect(() => insertTextChunks(fixture, [{ keyword: 'Title', text: 'curly ’ quote' }])).toThrow(REAL_ERROR);
    expect(() => insertTextChunks(fixture, [{ keyword: 'Title', text: 'a\u0000b' }])).toThrow(REAL_ERROR);
  });
});

describe('readTextChunks', () => {
  it('returns an empty list for a PNG with no text chunks', () => {
    expect(readTextChunks(fixture)).toEqual([]);
  });

  it('reads the independently built reference chunk', () => {
    expect(readTextChunks(withReferenceChunk())).toEqual([SOURCE]);
  });

  it('throws an Error on a bad signature', () => {
    expect(() => readTextChunks(new TextEncoder().encode('not a png at all'))).toThrow(REAL_ERROR);
  });
});

/** Independent chunk builder (node:zlib crc32), so the oracle does not share code with the module under test. */
function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(Buffer.from(type, 'latin1'), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

describe('bytes after IEND', () => {
  const TRAILING = new TextEncoder().encode('TRAILING-BYTES-AFTER-IEND');
  const withTrailing = new Uint8Array([...fixture, ...TRAILING]);

  it('insertTextChunks stops at IEND and keeps the trailing bytes untouched', () => {
    const out = insertTextChunks(withTrailing, [SOURCE]);
    expect(hex(out)).toBe(hex(new Uint8Array([...withReferenceChunk(), ...TRAILING])));
  });

  it('readTextChunks stops at IEND and ignores the trailing bytes', () => {
    expect(readTextChunks(new Uint8Array([...withReferenceChunk(), ...TRAILING]))).toEqual([SOURCE]);
  });

  it('does not read a text chunk that sits after IEND', () => {
    const after = buildChunk('tEXt', Buffer.from('Late\u0000no', 'latin1'));
    expect(readTextChunks(new Uint8Array([...fixture, ...after]))).toEqual([]);
  });
});

describe('a very large text chunk', () => {
  it('readTextChunks reads a 200,000-byte tEXt chunk without throwing', () => {
    const body = Buffer.alloc(200_000 - 4, 'x');
    const data = new Uint8Array(Buffer.concat([Buffer.from('Big\u0000', 'latin1'), body]));
    expect(data).toHaveLength(200_000);
    const png = new Uint8Array([
      ...fixture.subarray(0, IHDR_END),
      ...buildChunk('tEXt', data),
      ...fixture.subarray(IHDR_END),
    ]);
    const entries = readTextChunks(png);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.keyword).toBe('Big');
    expect(entries[0]?.text).toHaveLength(200_000 - 4);
    expect(entries[0]?.text).toBe('x'.repeat(200_000 - 4));
  });
});

describe('keyword rules from the PNG specification (32-126 and 161-255, no consecutive spaces)', () => {
  const attempt = (keyword: string) => () => insertTextChunks(fixture, [{ keyword, text: 'x' }]);

  it('rejects consecutive spaces inside a keyword', () => {
    expect(attempt('A  B')).toThrow(REAL_ERROR);
  });

  it.each([
    ['0x01', '\u0001'],
    ['0x1F', '\u001f'],
    ['0x7F (DEL)', '\u007f'],
    ['0x80', '\u0080'],
    ['0x9F', '\u009f'],
    ['0xA0 (no-break space)', ' '],
  ])('rejects a keyword containing the control character %s', (_name, char) => {
    expect(attempt(`A${char}B`)).toThrow(REAL_ERROR);
  });

  it('accepts a single interior space, 0x7E and 0xA1', () => {
    expect(attempt('Creation Time')).not.toThrow();
    expect(attempt('A~B')).not.toThrow();
    expect(attempt('A¡B')).not.toThrow();
  });
});
