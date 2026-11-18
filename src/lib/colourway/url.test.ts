// Feature 005 (share): expects `src/lib/colourway/url.ts` to export
//   encodeColourway(state: ColourwayState): string
//   decodeColourway(value: string): ColourwayState | null   (never throws)
// Wire format: swatches joined by '.', each `RRGGBB` or `RRGGBB~RRGGBB` (original~edit), no '#', uppercase out.
import { describe, expect, it } from 'vitest';

import { mulberry32 } from '../colour/prng';
import { decodeColourway, encodeColourway } from './url';
import type { ColourwayState } from './state';

const state = (original: string[], edits: Record<number, string> = {}): ColourwayState => ({ original, edits });

describe('encodeColourway', () => {
  it('writes an edited swatch as original~edit, without hashes, joined by dots (the documented example)', () => {
    expect(encodeColourway(state(['#1F3A2B', '#C04030'], { 1: '#E0D0A0' }))).toBe('1F3A2B.C04030~E0D0A0');
  });

  it('writes a state with no edits without any tilde', () => {
    const out = encodeColourway(state(['#1F3A2B', '#C04030', '#FFFFFF']));
    expect(out).toBe('1F3A2B.C04030.FFFFFF');
    expect(out).not.toContain('~');
  });

  it('writes a single swatch with no dot', () => {
    expect(encodeColourway(state(['#000000']))).toBe('000000');
  });

  it('writes every swatch as edited when all are edited', () => {
    expect(encodeColourway(state(['#111111', '#222222'], { 0: '#AAAAAA', 1: '#BBBBBB' }))).toBe(
      '111111~AAAAAA.222222~BBBBBB',
    );
  });

  it('uppercases lowercase input hex on output', () => {
    expect(encodeColourway(state(['#abcdef'], { 0: '#fedcba' }))).toBe('ABCDEF~FEDCBA');
  });

  it('is at most 128 characters for the largest state (8 edited swatches), so it always decodes', () => {
    const original = Array.from({ length: 8 }, (_, i) => `#${String(i).repeat(6)}`);
    const edits = Object.fromEntries(original.map((_, i) => [i, '#ABCDEF']));
    expect(encodeColourway(state(original, edits)).length).toBeLessThanOrEqual(128);
  });
});

describe('decodeColourway: valid input', () => {
  it('reads the documented example', () => {
    expect(decodeColourway('1F3A2B.C04030~E0D0A0')).toEqual(state(['#1F3A2B', '#C04030'], { 1: '#E0D0A0' }));
  });

  it('accepts lowercase hex and returns uppercase with a hash', () => {
    expect(decodeColourway('abcdef~012345')).toEqual(state(['#ABCDEF'], { 0: '#012345' }));
  });

  it('reads a palette with no edits as an empty edits object', () => {
    expect(decodeColourway('111111.222222')).toEqual(state(['#111111', '#222222']));
  });

  it('accepts duplicate swatch colours, each edited independently', () => {
    expect(decodeColourway('AAAAAA.AAAAAA~BBBBBB.AAAAAA')).toEqual(
      state(['#AAAAAA', '#AAAAAA', '#AAAAAA'], { 1: '#BBBBBB' }),
    );
  });

  it('accepts exactly 8 swatches and exactly 1 swatch', () => {
    expect(decodeColourway(Array(8).fill('123456').join('.'))?.original).toHaveLength(8);
    expect(decodeColourway('123456')?.original).toHaveLength(1);
  });

  it('drops an edit equal to its original, ignoring case', () => {
    expect(decodeColourway('AAAAAA~aaaaaa')).toEqual(state(['#AAAAAA']));
    expect(decodeColourway('AAAAAA~AAAAAA.BBBBBB~CCCCCC')).toEqual(state(['#AAAAAA', '#BBBBBB'], { 1: '#CCCCCC' }));
  });

  it('accepts the longest possible valid value (8 edited swatches, 111 characters)', () => {
    const value = Array(8).fill('123456~ABCDEF').join('.'); // 8 * 13 + 7 = 111
    expect(value.length).toBeLessThanOrEqual(128);
    expect(decodeColourway(value)).not.toBeNull();
  });

  it('only ever produces edit indexes inside the palette', () => {
    const decoded = decodeColourway('111111~222222.333333~444444');
    const indexes = Object.keys(decoded?.edits ?? {}).map(Number);
    expect(indexes.every((i) => i >= 0 && i < (decoded?.original.length ?? 0))).toBe(true);
  });
});

describe('decodeColourway: invalid input returns null and never throws', () => {
  const nine = Array(9).fill('123456').join('.');
  const cases: Array<[string, string]> = [
    ['an empty string', ''],
    ['a lone dot', '.'],
    ['more than 8 swatches', nine],
    ['a hash prefix', '#123456'],
    ['a hash on the edit side', '123456~#654321'],
    ['a 5-digit hex', '12345'],
    ['a 7-digit hex', '1234567'],
    ['a 3-digit shorthand hex', 'FFF'],
    ['non-hex characters', 'GGGGGG'],
    ['a non-hex edit', '123456~12345Z'],
    ['an empty segment in the middle', '111111..222222'],
    ['a leading dot', '.111111'],
    ['a trailing dot', '111111.'],
    ['more than one tilde in a segment', '111111~222222~333333'],
    ['an empty original side', '~222222'],
    ['an empty edit side', '111111~'],
    ['a lone tilde', '~'],
    ['whitespace around the value', ' 111111 '],
    ['whitespace inside a segment', '111 11'],
    ['a newline', '111111\n'],
    ['a comma separator', '111111,222222'],
    ['unicode digits', '１１１１１１'],
    ['emoji', '😀😀😀'],
    ['a percent-encoded value', '%31%31%31%31%31%31'],
    ['a very long value', '1'.repeat(100_000)],
    ['a very long valid-looking value', Array(5000).fill('123456').join('.')],
  ];

  it.each(cases)('rejects %s', (_name, value) => {
    expect(() => decodeColourway(value)).not.toThrow();
    expect(decodeColourway(value)).toBeNull();
  });

  it('rejects a 129-character value (the valid 8-swatch value plus a ninth segment)', () => {
    // Boundary: a valid 8-segment value is 111 chars; adding a 9th segment of 17 chars makes 129.
    const ok = Array<string>(8).fill('123456~ABCDEF').join('.');
    expect(ok.length).toBe(111);
    expect(decodeColourway(ok)).not.toBeNull();
    expect(decodeColourway(`${ok}.${'1'.repeat(17)}`)).toBeNull(); // 129 chars
  });

  it('does not throw for non-string junk passed through a cast', () => {
    const junkValues: unknown[] = [undefined, null, 42, {}, [], ['111111']];
    for (const junk of junkValues as string[]) {
      expect(() => decodeColourway(junk)).not.toThrow();
      expect(decodeColourway(junk)).toBeNull();
    }
  });
});

describe('colourway URL round trip', () => {
  const hex = (rand: () => number): string =>
    `#${Math.floor(rand() * 0x1000000)
      .toString(16)
      .padStart(6, '0')
      .toUpperCase()}`;

  function randomState(rand: () => number): ColourwayState {
    const count = 1 + Math.floor(rand() * 8);
    const original = Array.from({ length: count }, () => hex(rand));
    const edits: Record<number, string> = {};
    original.forEach((orig, i) => {
      if (rand() < 0.5) {
        const edit = hex(rand);
        if (edit !== orig) edits[i] = edit;
      }
    });
    return { original, edits };
  }

  it('decode(encode(s)) deep-equals s for 500 seeded random valid states of 1 to 8 swatches', () => {
    const rand = mulberry32(2026);
    const sizes = new Set<number>();
    for (let n = 0; n < 500; n++) {
      const s = randomState(rand);
      sizes.add(s.original.length);
      expect(decodeColourway(encodeColourway(s)), encodeColourway(s)).toEqual(s);
    }
    expect([...sizes].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('round trips hand-picked states: no edits, all edited, duplicates, extremes', () => {
    const picks = [
      state(['#000000']),
      state(['#FFFFFF'], { 0: '#000000' }),
      state(['#1F3A2B', '#C04030', '#E0D0A0', '#102030']),
      state(['#111111', '#222222', '#333333'], { 0: '#AAAAAA', 1: '#BBBBBB', 2: '#CCCCCC' }),
      state(['#ABABAB', '#ABABAB', '#ABABAB'], { 1: '#ABABAC' }),
      state(Array<string>(8).fill('#0A0B0C'), { 7: '#C0B0A0' }),
    ];
    for (const s of picks) expect(decodeColourway(encodeColourway(s))).toEqual(s);
  });

  it('encode is idempotent through decode: encode(decode(encode(s))) equals encode(s)', () => {
    const s = state(['#1F3A2B', '#C04030'], { 1: '#E0D0A0' });
    const once = encodeColourway(s);
    expect(encodeColourway(decodeColourway(once) ?? state([]))).toBe(once);
  });
});
