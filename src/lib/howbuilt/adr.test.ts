// Feature 007 (how-built): expects `src/lib/howbuilt/adr.ts` to export
//   isAdrFile(filename: string): boolean            true for /^\d{4}-.+\.md$/ except 0000-template.md
//   parseAdr(filename, md): { ok: true; adr: Adr } | { ok: false; error: string }
//   parseAdrs(files: { filename: string; content: string }[]): { adrs: Adr[]; errors: string[] }
// Adr = { number, slug, title, status, date, body }.  `slug` is the filename minus `NNNN-` and `.md`.
// parseAdrs silently skips files for which isAdrFile is false (template, other extensions);
// a file that passes isAdrFile but cannot be parsed (e.g. no title) is reported in `errors`,
// and the error string mentions that filename.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isAdrFile, parseAdr, parseAdrs } from './adr';

// Excerpt copied from the real docs/adr/0005-colourway-url-format.md
const ADR5 = `# ADR 0005: The colourway URL carries the full palette

- **Status:** Accepted
- **Date:** 2026-11-19

## Context

A colourway has to live in the URL query string (no accounts, no database), so a link reproduces it exactly.

## Options considered

1. **\`k\` + edits by index** (\`?k=6&e=2:C04030\`). Shortest.

## Decision

The full palette.
`;

function ok(filename: string, md: string) {
  const r = parseAdr(filename, md);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.adr;
}

describe('isAdrFile', () => {
  it('is true for a numbered markdown file', () => {
    expect(isAdrFile('0005-colourway-url-format.md')).toBe(true);
    expect(isAdrFile('0001-nextjs-on-vercel.md')).toBe(true);
  });

  it('is false for the template', () => {
    expect(isAdrFile('0000-template.md')).toBe(false);
  });

  it('is true for a 0000-prefixed file that is not the template', () => {
    expect(isAdrFile('0000-other.md')).toBe(true);
  });

  it('is false for non-markdown files', () => {
    for (const f of ['0005-colourway-url-format.txt', '0005-x.md.bak', '0005-x', '.gitkeep', 'README']) {
      expect(isAdrFile(f)).toBe(false);
    }
  });

  it('is false when the number is not exactly four digits', () => {
    for (const f of ['005-x.md', '00005-x.md', 'abcd-x.md', '0005.md', '0005-.md']) {
      expect(isAdrFile(f)).toBe(false);
    }
  });

  it('never throws', () => {
    fc.assert(fc.property(fc.string(), (s) => typeof isAdrFile(s) === 'boolean'));
  });
});

describe('parseAdr', () => {
  it('reads the number and slug from the filename', () => {
    const adr = ok('0005-colourway-url-format.md', ADR5);
    expect(adr.number).toBe(5);
    expect(adr.slug).toBe('colourway-url-format');
  });

  it('reads a number with leading zeros as an integer, not octal or a string', () => {
    expect(ok('0010-x.md', ADR5).number).toBe(10);
    expect(ok('0009-x.md', ADR5).number).toBe(9);
  });

  it('strips the "ADR NNNN:" prefix from the title', () => {
    expect(ok('0005-x.md', ADR5).title).toBe('The colourway URL carries the full palette');
  });

  it('keeps colons and quotes that appear later in the title', () => {
    const md =
      "# ADR 0003: Static CSP: 'unsafe-inline' instead of nonces\n\n- **Status:** Accepted\n- **Date:** 2026-11-15\n";
    expect(ok('0003-x.md', md).title).toBe("Static CSP: 'unsafe-inline' instead of nonces");
  });

  it('reads status and date from the metadata bullets', () => {
    const adr = ok('0005-x.md', ADR5);
    expect(adr.status).toBe('Accepted');
    expect(adr.date).toBe('2026-11-19');
  });

  it('keeps a multi-word status such as "Superseded by 0007"', () => {
    const md = ADR5.replace('Accepted', 'Superseded by 0007');
    expect(ok('0005-x.md', md).status).toBe('Superseded by 0007');
  });

  it('puts only the markdown after the metadata lines in body', () => {
    const { body } = ok('0005-x.md', ADR5);
    expect(body.trimStart().startsWith('## Context')).toBe(true);
    expect(body).toContain('## Options considered');
    expect(body).toContain('## Decision');
    expect(body).toContain('The full palette.');
    expect(body).not.toContain('# ADR 0005');
    expect(body).not.toContain('**Status:**');
    expect(body).not.toContain('**Date:**');
  });

  it('works with CRLF line endings', () => {
    const adr = ok('0005-x.md', ADR5.replace(/\n/g, '\r\n'));
    expect(adr.title).toBe('The colourway URL carries the full palette');
    expect(adr.status).toBe('Accepted');
    expect(adr.date).toBe('2026-11-19');
    expect(adr.body.trimStart().startsWith('## Context')).toBe(true);
  });

  it('fails when the filename has no four-digit number', () => {
    for (const f of ['colourway-url-format.md', '5-x.md', '0005-x.txt', '0005.md', '']) {
      const r = parseAdr(f, ADR5);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    }
  });

  it('fails when there is no title heading', () => {
    const r = parseAdr('0005-x.md', '- **Status:** Accepted\n- **Date:** 2026-11-19\n\n## Context\n\ntext');
    expect(r.ok).toBe(false);
  });

  it('fails on an empty document', () => {
    expect(parseAdr('0005-x.md', '').ok).toBe(false);
  });

  it('fails when the first heading is not an ADR title', () => {
    expect(parseAdr('0005-x.md', '## Context\n\nno title here').ok).toBe(false);
  });

  it('never throws for any filename and content', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (f, c) => {
        expect(typeof parseAdr(f, c).ok).toBe('boolean');
      }),
    );
  });
});

describe('parseAdrs', () => {
  const file = (n: string, title: string) => ({
    filename: `${n}-thing.md`,
    content: `# ADR ${n}: ${title}\n\n- **Status:** Accepted\n- **Date:** 2026-11-15\n\n## Context\n\nc`,
  });

  it('sorts adrs ascending by number regardless of input order', () => {
    const { adrs, errors } = parseAdrs([file('0010', 'ten'), file('0002', 'two'), file('0001', 'one')]);
    expect(errors).toEqual([]);
    expect(adrs.map((a) => a.number)).toEqual([1, 2, 10]);
    expect(adrs.map((a) => a.title)).toEqual(['one', 'two', 'ten']);
  });

  it('sorts numerically, not as strings', () => {
    const { adrs } = parseAdrs([file('0010', 'a'), file('0009', 'b')]);
    expect(adrs.map((a) => a.number)).toEqual([9, 10]);
  });

  it('excludes the template without reporting an error', () => {
    const template = { filename: '0000-template.md', content: '# ADR NNNN: Title\n\n- **Status:** Proposed\n' };
    const { adrs, errors } = parseAdrs([template, file('0001', 'one')]);
    expect(adrs.map((a) => a.number)).toEqual([1]);
    expect(errors).toEqual([]);
  });

  it('skips non-markdown files silently', () => {
    const { adrs, errors } = parseAdrs([{ filename: '0002-x.txt', content: 'x' }, file('0001', 'one')]);
    expect(adrs).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it('collects an error naming the file when a numbered file has no title, and keeps the good ones', () => {
    const bad = { filename: '0003-broken.md', content: 'no heading at all' };
    const { adrs, errors } = parseAdrs([file('0001', 'one'), bad]);
    expect(adrs.map((a) => a.number)).toEqual([1]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('0003-broken.md');
  });

  it('returns empty results for no files', () => {
    expect(parseAdrs([])).toEqual({ adrs: [], errors: [] });
  });

  it('parses every real file in docs/adr with no errors and leaves out the template', () => {
    const dir = join(process.cwd(), 'docs', 'adr');
    const names = readdirSync(dir).filter((n) => n.endsWith('.md'));
    const files = names.map((filename) => ({ filename, content: readFileSync(join(dir, filename), 'utf8') }));
    const { adrs, errors } = parseAdrs(files);
    expect(errors).toEqual([]);
    expect(adrs).toHaveLength(names.length - 1);
    expect(adrs.map((a) => a.number)).toEqual([...adrs.map((a) => a.number)].sort((a, b) => a - b));
    const three = adrs.find((a) => a.number === 3)!;
    expect(three.title).toBe("Static CSP with 'unsafe-inline' instead of nonces");
    expect(three.status).toBe('Accepted');
    expect(three.date).toBe('2026-11-15');
    for (const a of adrs) {
      expect(a.title.length).toBeGreaterThan(0);
      expect(a.title).not.toMatch(/^ADR\s*\d/);
      expect(a.body).toContain('## Context');
    }
  });
});
