// Feature 005 (share): expects `src/lib/colourway/url.ts` to export
//   colourwayHref(href: string, encoded: string | null): string   (throws on an unparseable href; the caller guards)
//   readColourwayParam(search: string): { kind: 'none' } | { kind: 'invalid' } | { kind: 'ok'; state }
import { describe, expect, it } from 'vitest';

import { colourwayHref, readColourwayParam } from './url';

const ENC = '1F3A2B.C04030~E0D0A0';

describe('colourwayHref', () => {
  it('adds cw to a URL with no query, leaving "." and "~" unescaped', () => {
    expect(colourwayHref('https://example.com/design/123', ENC)).toBe(`https://example.com/design/123?cw=${ENC}`);
  });

  it('replaces an existing cw instead of duplicating it', () => {
    expect(colourwayHref('https://example.com/d?cw=AAAAAA', ENC)).toBe(`https://example.com/d?cw=${ENC}`);
  });

  it('leaves exactly one cw when the URL had several', () => {
    const out = new URL(colourwayHref('https://example.com/d?cw=AAAAAA&cw=BBBBBB&cw=CCCCCC', ENC));
    expect(out.searchParams.getAll('cw')).toEqual([ENC]);
  });

  it('removes every cw when given null', () => {
    const out = new URL(colourwayHref('https://example.com/d?cw=AAAAAA&x=1&cw=BBBBBB', null));
    expect(out.searchParams.has('cw')).toBe(false);
    expect(out.searchParams.get('x')).toBe('1');
  });

  it('drops the "?" entirely when null removes the only param', () => {
    expect(colourwayHref('https://example.com/d?cw=AAAAAA', null)).toBe('https://example.com/d');
  });

  it('leaves a URL with no cw unchanged when given null', () => {
    expect(colourwayHref('https://example.com/d?x=1', null)).toBe('https://example.com/d?x=1');
  });

  it('preserves other query params, the path, the origin and the hash', () => {
    const out = new URL(colourwayHref('https://example.com/a/b?q=morris&page=2#top', ENC));
    expect(out.origin).toBe('https://example.com');
    expect(out.pathname).toBe('/a/b');
    expect(out.hash).toBe('#top');
    expect(out.searchParams.get('q')).toBe('morris');
    expect(out.searchParams.get('page')).toBe('2');
    expect(out.searchParams.get('cw')).toBe(ENC);
  });

  it('keeps the hash when removing cw', () => {
    expect(colourwayHref('https://example.com/d?cw=AAAAAA#frag', null)).toBe('https://example.com/d#frag');
  });

  it('preserves the port', () => {
    expect(colourwayHref('http://localhost:3000/design/9?x=1', ENC)).toBe(
      `http://localhost:3000/design/9?x=1&cw=${ENC}`,
    );
  });

  it('does not double-encode other params that already contain escapes', () => {
    const out = colourwayHref('https://example.com/d?q=a%20b', ENC);
    expect(new URL(out).searchParams.get('q')).toBe('a b');
    expect(out).not.toContain('%25');
  });

  it('does not percent-encode "." or "~" in the output', () => {
    const out = colourwayHref('https://example.com/d', ENC);
    expect(out).not.toMatch(/%2E|%7E/i);
    expect(out.endsWith(`cw=${ENC}`)).toBe(true);
  });

  it.each(['', 'not a url', '/relative/only?x=1', '://nohost'])(
    'throws for the invalid href %j (the caller guards)',
    (href) => {
      expect(() => colourwayHref(href, ENC)).toThrow(TypeError);
    },
  );
});

describe('readColourwayParam', () => {
  it('returns none for an empty search string', () => {
    expect(readColourwayParam('')).toEqual({ kind: 'none' });
  });

  it('returns none when cw is absent', () => {
    expect(readColourwayParam('?q=morris&page=2')).toEqual({ kind: 'none' });
  });

  it('decodes a valid cw with a leading "?"', () => {
    expect(readColourwayParam(`?cw=${ENC}`)).toEqual({
      kind: 'ok',
      state: { original: ['#1F3A2B', '#C04030'], edits: { 1: '#E0D0A0' } },
    });
  });

  it('decodes a valid cw without a leading "?"', () => {
    expect(readColourwayParam(`cw=${ENC}`)).toMatchObject({ kind: 'ok' });
  });

  it('finds cw among other params', () => {
    expect(readColourwayParam(`?a=1&cw=${ENC}&b=2`)).toMatchObject({ kind: 'ok' });
  });

  it('returns invalid for an empty cw value', () => {
    expect(readColourwayParam('?cw=')).toEqual({ kind: 'invalid' });
  });

  it('returns invalid for a cw with no "=" at all', () => {
    expect(readColourwayParam('?cw')).toEqual({ kind: 'invalid' });
  });

  it.each(['ZZZZZZ', '1F3A2B.', '12345', '1F3A2B~', '1F3A2B~AAAAAA~BBBBBB'])(
    'returns invalid for the undecodable cw %j',
    (value) => {
      expect(readColourwayParam(`?cw=${value}`)).toEqual({ kind: 'invalid' });
    },
  );

  it('uses the first cw when there are several, even if a later one is invalid', () => {
    expect(readColourwayParam(`?cw=${ENC}&cw=ZZZZZZ`)).toMatchObject({ kind: 'ok' });
  });

  it('uses the first cw when it is invalid, even if a later one is valid', () => {
    expect(readColourwayParam(`?cw=ZZZZZZ&cw=${ENC}`)).toEqual({ kind: 'invalid' });
  });

  it('never throws on malformed percent escapes', () => {
    expect(() => readColourwayParam('?%E0%A4%A&cw=%E0%A4%A')).not.toThrow();
  });
});
