// Behaviour beyond the main spec in parse.test.ts: block boundaries, escapes, nesting, table shapes.
import { describe, expect, it } from 'vitest';

import { isSafeHref } from './href';
import { parseInline, parseMarkdown, type Block, type Inline } from './parse';

const text = (value: string): Inline => ({ type: 'text', value });
const items = (b: Block | undefined): Inline[][] => (b?.type === 'list' ? b.items : []);

describe('lists', () => {
  it('reads ordered lists with a ) marker', () => {
    const [b] = parseMarkdown('1) a\n2) b');
    expect(b).toMatchObject({ type: 'list', ordered: true });
    expect(items(b)).toEqual([[text('a')], [text('b')]]);
  });

  it('joins an indented continuation line into the item above it', () => {
    const [b] = parseMarkdown('- first\n  more of first\n- second');
    expect(items(b)).toEqual([[text('first more of first')], [text('second')]]);
  });

  it('keeps one list across a single blank line between items', () => {
    const blocks = parseMarkdown('- a\n\n- b');
    expect(blocks).toHaveLength(1);
    expect(items(blocks[0])).toHaveLength(2);
  });

  it('ends the list at a blank line when no item follows', () => {
    expect(parseMarkdown('- a\n\nafter').map((b) => b.type)).toEqual(['list', 'paragraph']);
  });

  it('starts a new list when the marker kind changes', () => {
    const blocks = parseMarkdown('- a\n\n1. b');
    expect(blocks.map((b) => b.type)).toEqual(['list', 'list']);
    expect(blocks.map((b) => (b.type === 'list' ? b.ordered : null))).toEqual([false, true]);
  });

  it('reads a list that runs to the end of the input', () => {
    expect(items(parseMarkdown('- a')[0])).toEqual([[text('a')]]);
  });

  it('reads an empty bullet as an empty item', () => {
    expect(items(parseMarkdown('- x\n- ')[0])).toHaveLength(2);
  });
});

describe('block boundaries', () => {
  it('drops thematic breaks', () => {
    expect(parseMarkdown('a\n\n---\n\nb').map((b) => b.type)).toEqual(['paragraph', 'paragraph']);
    expect(parseMarkdown('* * *')).toEqual([]);
    expect(parseMarkdown('___')).toEqual([]);
  });

  it('ends a paragraph at a heading, a fence and a list', () => {
    expect(parseMarkdown('text\n# H').map((b) => b.type)).toEqual(['paragraph', 'heading']);
    expect(parseMarkdown('text\n```\nc\n```').map((b) => b.type)).toEqual(['paragraph', 'code']);
    expect(parseMarkdown('text\n- item').map((b) => b.type)).toEqual(['paragraph', 'list']);
  });

  it('reads CRLF documents', () => {
    expect(parseMarkdown('# T\r\n\r\ntext\r\n- a\r\n').map((b) => b.type)).toEqual(['heading', 'paragraph', 'list']);
  });

  it('takes only the first word of a fence info string as the language', () => {
    expect(parseMarkdown('```ts title="x"\nc\n```')[0]).toEqual({ type: 'code', lang: 'ts', value: 'c' });
  });

  it('closes a fence only with one at least as long', () => {
    const [b] = parseMarkdown('````\n```\nx\n````\nafter');
    expect(b).toEqual({ type: 'code', lang: null, value: '```\nx' });
  });

  it('allows a closing fence with trailing spaces and ends the block there', () => {
    expect(parseMarkdown('```\na\n```  \nb').map((b) => b.type)).toEqual(['code', 'paragraph']);
  });

  it('reads an empty fenced block', () => {
    expect(parseMarkdown('```\n```')[0]).toEqual({ type: 'code', lang: null, value: '' });
  });

  it('does not read a heading with no text', () => {
    expect(parseMarkdown('## ')[0]).toMatchObject({ type: 'paragraph' });
  });
});

describe('tables', () => {
  const rows = (b: Block | undefined) => (b?.type === 'table' ? b.rows : []);
  const header = (b: Block | undefined) => (b?.type === 'table' ? b.header : []);

  it('reads a table without outer pipes', () => {
    const [b] = parseMarkdown('a | b\n--|--\n1 | 2');
    expect(header(b)).toEqual([[text('a')], [text('b')]]);
    expect(rows(b)).toEqual([[[text('1')], [text('2')]]]);
  });

  it('pads short rows and truncates long ones to the header width', () => {
    const [b] = parseMarkdown('| a | b |\n| - | - |\n| 1 |\n| 1 | 2 | 3 |');
    expect(rows(b)).toEqual([
      [[text('1')], []],
      [[text('1')], [text('2')]],
    ]);
  });

  it('keeps an escaped pipe inside a cell', () => {
    const [b] = parseMarkdown('| a |\n| - |\n| x \\| y |');
    expect(rows(b)).toEqual([[[text('x | y')]]]);
  });

  it('is not a table when the delimiter row has a different number of columns', () => {
    expect(parseMarkdown('| a | b |\n| - |')[0]).toMatchObject({ type: 'paragraph' });
  });

  it('is not a table when the second line is not a delimiter row', () => {
    expect(parseMarkdown('| a |\n| b |')[0]).toMatchObject({ type: 'paragraph' });
  });

  it('is not a table when the header is the last line', () => {
    expect(parseMarkdown('| a |')[0]).toMatchObject({ type: 'paragraph' });
  });

  it('ends the table at the first line without a pipe', () => {
    const blocks = parseMarkdown('| a |\n| - |\n| 1 |\nafter');
    expect(blocks.map((b) => b.type)).toEqual(['table', 'paragraph']);
  });
});

describe('inlines', () => {
  it('lets a backslash escape punctuation, and leaves other backslashes alone', () => {
    expect(parseInline('\\*not em\\*')).toEqual([text('*not em*')]);
    expect(parseInline('a\\b')).toEqual([text('a\\b')]);
  });

  it('reads a link whose label holds brackets, and whose href holds balanced parentheses', () => {
    expect(parseInline('[a [b] c](https://x.example/a_(b))')).toEqual([
      { type: 'link', href: 'https://x.example/a_(b)', children: [text('a [b] c')] },
    ]);
  });

  it('skips an escaped bracket when finding the end of a label', () => {
    const [link] = parseInline('[a \\] b](/x)');
    expect(link).toMatchObject({ type: 'link', href: '/x', children: [text('a ] b')] });
  });

  it('keeps formatting inside a link label', () => {
    const [link] = parseInline('[**b**](/x)');
    expect(link).toMatchObject({ type: 'link', children: [{ type: 'strong' }] });
  });

  it('keeps an unclosed link label as text', () => {
    expect(parseInline('[a')).toEqual([text('[a')]);
    expect(parseInline('[a](')).toEqual([text('[a](')]);
  });

  it('does not make emphasis inside words with underscores', () => {
    expect(parseInline('snake_case_name')).toEqual([text('snake_case_name')]);
    expect(parseInline('a _b_c')).toEqual([text('a _b_c')]);
    expect(parseInline('a _b_ c')).toEqual([text('a '), { type: 'em', children: [text('b')] }, text(' c')]);
  });

  it('does not make emphasis around spaces or nothing', () => {
    expect(parseInline('a * b * c')).toEqual([text('a * b * c')]);
    expect(parseInline('** a **')).toEqual([text('** a **')]);
    expect(parseInline('****')).toEqual([text('****')]);
    expect(parseInline('``')).toEqual([text('``')]);
    expect(parseInline('*a')).toEqual([text('*a')]);
  });

  it('stops nesting at a fixed depth and keeps the rest as text', () => {
    let nested = 'x';
    for (let i = 0; i < 12; i++) nested = `[${nested}](/x)`;
    const out = parseInline(nested);
    expect(JSON.stringify(out)).toContain('x');
    expect(out).toHaveLength(1);
  });

  it('returns nothing for an empty string', () => {
    expect(parseInline('')).toEqual([]);
  });
});

describe('isSafeHref', () => {
  it('refuses the empty string and invisible or confusing characters', () => {
    for (const href of ['', '/a\\b', '/\\evil.example', ' /x', '/a\u007fb', '/a b', '/a b', '/a​b', '/a‏b', '﻿/x']) {
      expect(isSafeHref(href), JSON.stringify(href)).toBe(false);
    }
  });

  it('accepts http(s), fragments and relative paths, and refuses other schemes', () => {
    for (const href of ['https://a.example', 'HTTP://a.example', '#x', '/x', 'x/y', 'x/y:z']) {
      expect(isSafeHref(href), href).toBe(true);
    }
    for (const href of ['javascript:x', 'mailto:a@b.example', '//host', 'a:b']) {
      expect(isSafeHref(href), href).toBe(false);
    }
  });
});
