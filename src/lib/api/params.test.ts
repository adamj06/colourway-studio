import { describe, expect, it } from 'vitest';
import { normaliseQuery, parseSearchParams, parseSystemNumber } from './params';
import { MAX_PAGE } from './query-limits';

describe('normaliseQuery (exported from params.ts)', () => {
  it.each([
    ['Indian  ', 'indian'],
    ['  INDIAN', 'indian'],
    ['  Strawberry   Thief  ', 'strawberry thief'],
    ['in\tdian', 'in dian'],
    ['a\nb', 'a b'],
    ['a\r\n\r\nb', 'a b'],
    ['a b', 'a b'],
    ['a \t\n  b', 'a b'],
    [' \tfruit\n', 'fruit'],
    ['', ''],
    ['   ', ''],
    ['already normal', 'already normal'],
  ])('turns %j into %j', (input, expected) => {
    expect(normaliseQuery(input)).toBe(expected);
  });

  it('is idempotent', () => {
    for (const input of ['  A   B\t', 'x', '', 'Mixed  CASE  words ']) {
      expect(normaliseQuery(normaliseQuery(input))).toBe(normaliseQuery(input));
    }
  });

  it('never leaves leading, trailing or repeated whitespace', () => {
    for (const input of ['  A   B\t', '\n\nx\n\n', 'a  b']) {
      expect(normaliseQuery(input)).not.toMatch(/^\s|\s$|\s{2}|[^\S ]/);
    }
  });

  it('does not apply Unicode compatibility folding (NFKC is not required)', () => {
    expect(normaliseQuery('Café')).toBe('café');
  });
});

describe('parseSearchParams returns the normalised q, which is the cache key', () => {
  it('gives "A  B" and "a b" the same q', () => {
    const a = parseSearchParams(sp(`q=${encodeURIComponent('A  B')}`));
    const b = parseSearchParams(sp('q=a%20b'));
    expect(a).toEqual({ ok: true, value: { q: 'a b', page: 1 } });
    expect(b).toEqual(a);
  });

  it('lowercases and collapses tabs, newlines and nbsp', () => {
    const r = parseSearchParams(sp(`q=${encodeURIComponent('  Strawberry\t\n THIEF ')}`));
    expect(r).toEqual({ ok: true, value: { q: 'strawberry thief', page: 1 } });
  });

  it('treats a whitespace-only q as empty', () => {
    expect(parseSearchParams(sp('q=%20%09%20'))).toEqual({ ok: true, value: { q: '', page: 1 } });
  });

  it('applies the length limit to the raw input: 101 letters are rejected even though they would stay 101', () => {
    expect(parseSearchParams(sp(`q=${'A'.repeat(101)}`)).ok).toBe(false);
    expect(parseSearchParams(sp(`q=${'A'.repeat(100)}`)).ok).toBe(true);
  });
});

const sp = (s: string) => new URLSearchParams(s);

describe('parseSearchParams', () => {
  it('defaults to q "" and page 1', () => {
    expect(parseSearchParams(sp(''))).toEqual({ ok: true, value: { q: '', page: 1 } });
  });

  it('parses q and page', () => {
    expect(parseSearchParams(sp('q=strawberry&page=3'))).toEqual({ ok: true, value: { q: 'strawberry', page: 3 } });
  });

  it('trims q', () => {
    expect(parseSearchParams(sp('q=%20%20fruit%20'))).toEqual({ ok: true, value: { q: 'fruit', page: 1 } });
  });

  it('accepts a q of exactly 100 characters and rejects 101', () => {
    expect(parseSearchParams(sp(`q=${'a'.repeat(100)}`)).ok).toBe(true);
    expect(parseSearchParams(sp(`q=${'a'.repeat(101)}`)).ok).toBe(false);
  });

  it('measures the q limit after trimming', () => {
    expect(parseSearchParams(sp(`q=${'a'.repeat(100)}%20%20`)).ok).toBe(true);
  });

  it('rejects repeated q params', () => {
    expect(parseSearchParams(sp('q=a&q=b')).ok).toBe(false);
  });

  it('rejects repeated page params', () => {
    expect(parseSearchParams(sp('page=1&page=2')).ok).toBe(false);
  });

  it('caps pages at 40 (the live collection is 33 pages of 24)', () => {
    expect(MAX_PAGE).toBe(40);
  });

  it.each(['1', '2', '33', '40'])('accepts page %s', (p) => {
    expect(parseSearchParams(sp(`page=${p}`))).toEqual({ ok: true, value: { q: '', page: Number(p) } });
  });

  it.each(['0', '-1', '1.5', 'abc', '41', '100', '101', '', ' ', '1e2', '0x10', 'NaN'])('rejects page %j', (p) => {
    expect(parseSearchParams(sp(`page=${encodeURIComponent(p)}`)).ok).toBe(false);
  });

  it('returns a non-empty message when not ok', () => {
    const result = parseSearchParams(sp('page=0'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('ignores unknown params', () => {
    expect(parseSearchParams(sp('id_organisation=X&q=a'))).toEqual({ ok: true, value: { q: 'a', page: 1 } });
  });
});

describe('parseSystemNumber', () => {
  it.each(['O1', 'O78207', 'O1234567890'])('accepts %s', (id) => {
    expect(parseSystemNumber(id)).toEqual({ ok: true, value: id });
  });

  it.each(['', 'o1', 'O', 'O12345678901', '../x', 'O1/../x', 'O1?x=1', ' O1', 'O1\n', 'P1', 'O1a', 'O-1'])(
    'rejects %j',
    (id) => {
      const result = parseSystemNumber(id);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message.length).toBeGreaterThan(0);
      }
    },
  );
});
