// Feature 007 (how-built): expects `src/lib/markdown/parse.ts` to export
//   parseMarkdown(src: string): Block[]    (pure, never throws)
// AST shape assumed by these tests:
//   Block  = { type:'heading', level:1..6, children:Inline[] }
//          | { type:'paragraph', children:Inline[] }
//          | { type:'list', ordered:boolean, items:Inline[][] }
//          | { type:'code', lang:string|null, value:string }
//          | { type:'table', header:Inline[][], rows:Inline[][][] }
//   Inline = { type:'text', value } | { type:'strong'|'em', children:Inline[] }
//          | { type:'code', value } | { type:'link', href, children:Inline[] }
// There is NO html node type: raw HTML is literal text.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parseMarkdown } from './parse';

type Node = { type: string; [k: string]: unknown };

/** Every inline node reachable from the blocks, depth first. */
function allInlines(blocks: unknown[]): Node[] {
  const out: Node[] = [];
  const visitInline = (n: unknown): void => {
    if (Array.isArray(n)) {
      n.forEach(visitInline);
      return;
    }
    if (n === null || typeof n !== 'object') return;
    const node = n as Node;
    out.push(node);
    if (Array.isArray(node.children)) node.children.forEach(visitInline);
  };
  const visitBlock = (b: unknown): void => {
    const blk = b as Node;
    if (Array.isArray(blk.children)) blk.children.forEach(visitInline);
    if (Array.isArray(blk.items)) blk.items.forEach(visitInline);
    if (Array.isArray(blk.header)) blk.header.forEach(visitInline);
    if (Array.isArray(blk.rows))
      blk.rows.forEach((r: unknown) => {
        (r as unknown[]).forEach(visitInline);
      });
  };
  blocks.forEach(visitBlock);
  return out;
}

const links = (blocks: unknown[]) => allInlines(blocks).filter((n) => n.type === 'link');

/** Text a reader would see (text and code values; links via their children). */
function plain(blocks: unknown[]): string {
  return allInlines(blocks)
    .filter((n) => n.type === 'text' || n.type === 'code')
    .map((n) => String(n.value))
    .join('');
}

/** Independent statement of the allowlist, used by the property tests. */
function hrefIsAllowed(href: string): boolean {
  if (href.startsWith('#')) return true;
  if (href.startsWith('//')) return false;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(href);
  if (scheme) return ['http', 'https'].includes(scheme[1]!.toLowerCase());
  // A relative path must not hide a scheme behind whitespace or control characters.
  return !Array.from(href).some(
    (ch) => ch.charCodeAt(0) <= 0x20 || (ch.charCodeAt(0) >= 0x7f && ch.charCodeAt(0) <= 0x9f),
  );
}

describe('parseMarkdown: blocks', () => {
  it('returns an empty list for an empty string', () => {
    expect(parseMarkdown('')).toEqual([]);
  });

  it('returns an empty list for whitespace and blank lines only', () => {
    expect(parseMarkdown('  \n\n \t\n')).toEqual([]);
  });

  it('reads headings of every level 1 to 6 with their text', () => {
    for (let level = 1; level <= 6; level++) {
      const blocks = parseMarkdown(`${'#'.repeat(level)} Title ${String(level)}`);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({ type: 'heading', level });
      expect(plain(blocks)).toBe(`Title ${String(level)}`);
    }
  });

  it('does not treat seven hashes as a heading', () => {
    expect(parseMarkdown('####### nope')[0]).toMatchObject({ type: 'paragraph' });
  });

  it('does not treat a hash with no space after it as a heading', () => {
    expect(parseMarkdown('#nope')[0]).toMatchObject({ type: 'paragraph' });
  });

  it('splits paragraphs on blank lines and joins soft-wrapped lines into one paragraph', () => {
    const blocks = parseMarkdown('first line\nsecond line\n\nnext paragraph');
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph']);
    expect(plain([blocks[0]])).toMatch(/first line\s+second line/);
    expect(plain([blocks[1]])).toBe('next paragraph');
  });

  it('reads a bullet list with one item per line', () => {
    const blocks = parseMarkdown('- one\n- two\n- three');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'list', ordered: false });
    expect((blocks[0] as unknown as { items: unknown[] }).items).toHaveLength(3);
    expect(plain(blocks)).toBe('onetwothree');
  });

  it('accepts * and + as bullet markers', () => {
    expect(parseMarkdown('* a\n* b')[0]).toMatchObject({ type: 'list', ordered: false });
    expect(parseMarkdown('+ a\n+ b')[0]).toMatchObject({ type: 'list', ordered: false });
  });

  it('reads an ordered list in order', () => {
    const blocks = parseMarkdown('1. alpha\n2. beta\n3. gamma');
    expect(blocks[0]).toMatchObject({ type: 'list', ordered: true });
    expect((blocks[0] as unknown as { items: unknown[] }).items).toHaveLength(3);
    expect(plain(blocks)).toBe('alphabetagamma');
  });

  it('reads inline formatting inside list items', () => {
    const blocks = parseMarkdown('- **Status:** Accepted');
    const item = (blocks[0] as unknown as { items: Node[][] }).items[0]!;
    expect(item[0]).toMatchObject({ type: 'strong' });
    expect(plain(blocks)).toBe('Status: Accepted');
  });

  it('keeps a paragraph after a list as its own block', () => {
    expect(parseMarkdown('- a\n- b\n\nafter').map((b) => b.type)).toEqual(['list', 'paragraph']);
  });

  it('reads a fenced code block with its language and verbatim content', () => {
    const blocks = parseMarkdown('```ts\nconst a = **1**;\n# not a heading\n```');
    expect(blocks).toEqual([{ type: 'code', lang: 'ts', value: 'const a = **1**;\n# not a heading' }]);
  });

  it('reads a fenced code block with no language as lang null', () => {
    const blocks = parseMarkdown('```\nplain\n```');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'code', value: 'plain' });
    expect((blocks[0] as unknown as { lang: string | null }).lang ?? null).toBeNull();
  });

  it('does not interpret markdown or html inside a code block', () => {
    const blocks = parseMarkdown('```\n<script>x</script> [a](javascript:alert(1))\n```');
    expect(blocks).toHaveLength(1);
    expect(links(blocks)).toHaveLength(0);
    expect((blocks[0] as unknown as { value: string }).value).toBe('<script>x</script> [a](javascript:alert(1))');
  });

  it('treats an unclosed code fence as code running to the end, without throwing', () => {
    const blocks = parseMarkdown('```js\nlet a = 1;');
    expect(blocks[0]).toMatchObject({ type: 'code', lang: 'js' });
    expect((blocks[0] as unknown as { value: string }).value).toContain('let a = 1;');
  });

  it('reads a GFM table into a header row and body rows', () => {
    const blocks = parseMarkdown(
      ['| Caught by | Entries |', '| --- | :-: |', '| human | 7 |', '| hook | 4 |'].join('\n'),
    );
    expect(blocks).toHaveLength(1);
    const t = blocks[0] as unknown as { type: string; header: Node[][]; rows: Node[][][] };
    expect(t.type).toBe('table');
    expect(t.header).toHaveLength(2);
    // `plain` walks blocks, so wrap the cells of a row in a paragraph.
    const row = (cells: Node[][]) => plain([{ type: 'paragraph', children: cells.flat() }]);
    expect(row(t.header)).toBe('Caught byEntries');
    expect(t.rows).toHaveLength(2);
    expect(row(t.rows[0]!)).toBe('human7');
    expect(row(t.rows[1]!)).toBe('hook4');
  });

  it('reads inline formatting inside table cells', () => {
    const blocks = parseMarkdown('| a |\n| --- |\n| **b** |');
    const t = blocks[0] as unknown as { rows: Node[][][] };
    expect(t.rows[0]![0]![0]).toMatchObject({ type: 'strong' });
  });

  it('does not make a table from pipes with no delimiter row', () => {
    expect(parseMarkdown('| a | b |\n| c | d |')[0]).toMatchObject({ type: 'paragraph' });
  });

  it('reads a block mix in document order', () => {
    const blocks = parseMarkdown('# T\n\ntext\n\n- a\n\n```\nc\n```');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'code']);
  });
});

describe('parseMarkdown: inlines', () => {
  const inl = (s: string) => (parseMarkdown(s)[0] as unknown as { children: Node[] }).children;

  it('reads strong text', () => {
    const strong = inl('a **bold** b').find((n) => n.type === 'strong')!;
    expect(strong).toBeDefined();
    expect(plain([{ type: 'paragraph', children: strong.children }])).toBe('bold');
  });

  it('reads emphasis with * and with _', () => {
    expect(inl('a *it* b').some((n) => n.type === 'em')).toBe(true);
    expect(inl('a _it_ b').some((n) => n.type === 'em')).toBe(true);
  });

  it('reads inline code and keeps its content unformatted', () => {
    const code = inl('use `**x**` here').find((n) => n.type === 'code')!;
    expect(code.value).toBe('**x**');
  });

  it('reads emphasis nested inside strong', () => {
    const strong = inl('**a *b* c**').find((n) => n.type === 'strong')!;
    expect((strong.children as Node[]).some((n) => n.type === 'em')).toBe(true);
  });

  it('reads a link with its href and text', () => {
    const [l] = links(parseMarkdown('see [the PR](https://github.com/a/b/pull/1) now'));
    expect(l).toMatchObject({ type: 'link', href: 'https://github.com/a/b/pull/1' });
    expect(plain([{ type: 'paragraph', children: l!.children }])).toBe('the PR');
  });

  it('keeps unclosed ** as literal text', () => {
    const blocks = parseMarkdown('a **b');
    expect(allInlines(blocks).some((n) => n.type === 'strong')).toBe(false);
    expect(plain(blocks)).toBe('a **b');
  });

  it('keeps an unclosed backtick as literal text', () => {
    const blocks = parseMarkdown('a `b');
    expect(allInlines(blocks).some((n) => n.type === 'code')).toBe(false);
    expect(plain(blocks)).toBe('a `b');
  });

  it('keeps a lone bracket pair or an unfinished link as literal text', () => {
    expect(plain(parseMarkdown('a [b](http://x'))).toBe('a [b](http://x');
    expect(links(parseMarkdown('a [b] c'))).toHaveLength(0);
  });
});

describe('parseMarkdown: raw HTML is never an html node', () => {
  it('keeps a script tag as literal text', () => {
    const blocks = parseMarkdown('<script>x</script>');
    expect(plain(blocks)).toBe('<script>x</script>');
    expect(JSON.stringify(blocks)).not.toMatch(/"type":"html"/);
  });

  it('keeps an img onerror tag as literal text', () => {
    const src = '<img src=x onerror=alert(1)>';
    const blocks = parseMarkdown(src);
    expect(plain(blocks)).toBe(src);
    expect(JSON.stringify(blocks)).not.toMatch(/"type":"html"/);
  });

  it('keeps html inside emphasis, headings, list items and table cells as text', () => {
    const blocks = parseMarkdown('# <b>h</b>\n\n- <i>x</i>\n\n| a |\n| - |\n| <u>c</u> |\n\n**<s>t</s>**');
    const text = plain(blocks);
    for (const frag of ['<b>h</b>', '<i>x</i>', '<u>c</u>', '<s>t</s>']) expect(text).toContain(frag);
    expect(allInlines(blocks).every((n) => ['text', 'strong', 'em', 'code', 'link'].includes(n.type))).toBe(true);
  });

  it('keeps an html comment as text', () => {
    expect(plain(parseMarkdown('<!-- hi -->'))).toBe('<!-- hi -->');
  });
});

describe('parseMarkdown: link href allowlist', () => {
  const allowed = [
    'http://example.com/a',
    'https://example.com/a?b=1#c',
    'HTTPS://Example.com',
    '/x',
    './x',
    '../x',
    'docs/adr/0005.md',
    '#section',
  ];
  for (const href of allowed) {
    it(`makes a link for the allowed href "${href}"`, () => {
      const ls = links(parseMarkdown(`[t](${href})`));
      expect(ls).toHaveLength(1);
      expect(ls[0]!.href).toBe(href);
    });
  }

  const blocked = [
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'DATA:text/html;base64,AAAA',
    'vbscript:msgbox(1)',
    'VbScript:msgbox(1)',
    'mailto:a@b.example',
    'file:///etc/passwd',
    'ftp://example.com/x',
    '//evil.example',
    '//evil.example/path',
    ' javascript:alert(1)',
    'JaVa\tScript:alert(1)',
    'java\nscript:alert(1)',
    'java\u0000script:alert(1)',
    '\u0001javascript:alert(1)',
    '\tjavascript:alert(1)',
    'javascript\t:alert(1)',
    ' javascript:alert(1)',
  ];
  for (const href of blocked) {
    it(`renders the link text as plain text for the blocked href ${JSON.stringify(href)}`, () => {
      const blocks = parseMarkdown(`before [LINKTEXT](${href}) after`);
      // If a parser still produced a link node, its href must itself be safe.
      expect(links(blocks).filter((l) => !hrefIsAllowed(String(l.href)))).toHaveLength(0);
      for (const l of links(blocks)) {
        expect(String(l.href).trim().toLowerCase()).not.toMatch(/^(javascript|data|vbscript):/);
      }
      expect(plain(blocks)).toContain('LINKTEXT');
    });
  }

  for (const href of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.example', 'JaVaScRiPt:x']) {
    it(`makes no link node at all for ${href}`, () => {
      expect(links(parseMarkdown(`[t](${href})`))).toHaveLength(0);
    });
  }

  it('blocks a dangerous href inside a list item and a table cell too', () => {
    const blocks = parseMarkdown('- [aa](javascript:1)\n\n| h |\n| - |\n| [bb](data:x) |');
    expect(links(blocks)).toHaveLength(0);
    expect(plain(blocks)).toContain('aa');
    expect(plain(blocks)).toContain('bb');
  });

  it('still makes safe links next to a blocked one in the same paragraph', () => {
    const ls = links(parseMarkdown('[bad](javascript:1) and [good](https://example.com)'));
    expect(ls.map((l) => l.href)).toEqual(['https://example.com']);
  });
});

describe('parseMarkdown: robustness (property)', () => {
  it('never throws on arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(() => parseMarkdown(s)).not.toThrow();
      }),
      { numRuns: 300 },
    );
  });

  it('never throws on arbitrary binary-ish strings', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (s) => {
        expect(() => parseMarkdown(s)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  const token = fc.constantFrom(
    '*',
    '**',
    '_',
    '`',
    '```',
    '[',
    ']',
    '(',
    ')',
    '|',
    '---',
    '#',
    '- ',
    '1. ',
    '<',
    '>',
    '\n',
    '\n\n',
    ' ',
    '\t',
    'a',
    'http://x.example',
    'javascript:',
    'JaVa\tScript:',
    '//e.example',
    '](',
    '[t](',
  );
  const markdownish = fc.array(token, { maxLength: 40 }).map((xs) => xs.join(''));

  it('never throws on markdown-shaped noise', () => {
    fc.assert(
      fc.property(markdownish, (s) => {
        expect(() => parseMarkdown(s)).not.toThrow();
      }),
      { numRuns: 500 },
    );
  });

  it('only ever emits links whose href is allowed, whatever the input', () => {
    fc.assert(
      fc.property(markdownish, (s) => {
        for (const l of links(parseMarkdown(s))) expect(hrefIsAllowed(String(l.href))).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('never emits an html node and only known block and inline types', () => {
    fc.assert(
      fc.property(markdownish, (s) => {
        const blocks = parseMarkdown(s);
        for (const n of allInlines(blocks)) expect(['text', 'strong', 'em', 'code', 'link']).toContain(n.type);
        for (const b of blocks) expect(['heading', 'paragraph', 'list', 'code', 'table']).toContain(b.type);
      }),
      { numRuns: 500 },
    );
  });
});
