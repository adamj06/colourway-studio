// Feature 007 (how-built): expects `src/lib/howbuilt/friction.ts` to export
//   parseFrictionLog(md: string): FrictionEntry[]     (never throws; newest first)
//   tallyCaughtBy(entries: FrictionEntry[]): { who: string; count: number }[]
// FrictionEntry = { timestamp, title, doing, wentWrong, resolvedBy, prevention, caughtBy } (all strings).
// Only `## YYYY-MM-DD HH:MM: title` headings outside fenced code blocks are entries.
// Sort is timestamp descending (string compare is fine for this format) and STABLE: equal
// timestamps keep their file order.  Continuation lines of a bullet are joined with a single space.
// tallyCaughtBy: `who` is the trimmed, lower-cased caughtBy (kept whole, never split on "+" or "/");
// an empty value counts as 'unknown'; sorted by count desc, then who ascending.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parseFrictionLog, tallyCaughtBy } from './friction';

// Shape copied from the real docs/friction-log.md (intro, summary table, template block, entries).
const REAL_EXCERPT = `# Friction log

Honest notes on where the agent or the tooling got in the way, written at the time it happened.

## Summary: who caught it (001 tooling, 19 entries)

| Caught by         | Entries | Which                              |
| ----------------- | ------- | ---------------------------------- |
| human             | 7       | 1, 2, 8, 9 (diagnosis), 14, 18, 19 |

Template:

\`\`\`
## YYYY-MM-DD HH:MM: short title
- **Doing:** what we were working on
- **What went wrong:** the agent's mistake, or the tooling problem
- **Resolved by:** what fixed it
- **Prevention:** CLAUDE.md rule / hook / prompt change / none needed
- **Caught by:** human plan review / reviewer agent / CI / hook / commit hooks / agent itself / human
\`\`\`

---

## 2026-11-15 12:56: create-next-app's AGENTS.md was invisible to Claude Code

- **Doing:** 001-tooling, first look at the scaffolded project.
- **What went wrong:** \`create-next-app\` generated \`AGENTS.md\` (version-matched Next 16 guidance), but Claude Code only reads \`CLAUDE.md\`, so the agent would never have seen it.
- **Resolved by:** An \`@AGENTS.md\` import in \`CLAUDE.md\`.
- **Prevention:** Check which instruction files the agent actually loads after scaffolding.
- **Caught by:** human

## 2026-11-15 13:04: Windows CRLF vs LF tooling noise

- **Doing:** 001-tooling, first commit.
- **What went wrong:** Git warned about line endings.
- **Resolved by:** A .gitattributes file.
- **Prevention:** none needed
- **Caught by:** hook
`;

const entryMd = (ts: string, title: string, caught = 'human') =>
  `## ${ts}: ${title}\n\n- **Doing:** d ${title}\n- **What went wrong:** w\n- **Resolved by:** r\n- **Prevention:** p\n- **Caught by:** ${caught}\n`;

describe('parseFrictionLog', () => {
  it('returns no entries for an empty string', () => {
    expect(parseFrictionLog('')).toEqual([]);
  });

  it('returns no entries for a document with no entry headings', () => {
    expect(parseFrictionLog('# Friction log\n\nJust an intro.\n')).toEqual([]);
  });

  it('reads every field of an entry', () => {
    const entries = parseFrictionLog(REAL_EXCERPT);
    const e = entries.find((x) => x.timestamp === '2026-11-15 12:56')!;
    expect(e).toEqual({
      timestamp: '2026-11-15 12:56',
      title: "create-next-app's AGENTS.md was invisible to Claude Code",
      doing: '001-tooling, first look at the scaffolded project.',
      wentWrong:
        '`create-next-app` generated `AGENTS.md` (version-matched Next 16 guidance), but Claude Code only reads `CLAUDE.md`, so the agent would never have seen it.',
      resolvedBy: 'An `@AGENTS.md` import in `CLAUDE.md`.',
      prevention: 'Check which instruction files the agent actually loads after scaffolding.',
      caughtBy: 'human',
    });
  });

  it('ignores the intro, the Summary section and the template code block', () => {
    const entries = parseFrictionLog(REAL_EXCERPT);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.title)).toEqual([
      'Windows CRLF vs LF tooling noise',
      "create-next-app's AGENTS.md was invisible to Claude Code",
    ]);
    expect(entries.some((e) => /Summary|short title/.test(e.title))).toBe(false);
  });

  it('does not treat a heading inside a fenced code block as an entry, even with a real-looking timestamp', () => {
    const md =
      '```\n## 2026-11-15 12:00: fake entry\n- **Caught by:** human\n```\n\n' + entryMd('2026-11-15 13:00', 'real');
    expect(parseFrictionLog(md).map((e) => e.title)).toEqual(['real']);
  });

  it('keeps colons inside the title after the timestamp', () => {
    const [e] = parseFrictionLog(entryMd('2026-11-15 10:00', 'foo: bar: baz'));
    expect(e!.timestamp).toBe('2026-11-15 10:00');
    expect(e!.title).toBe('foo: bar: baz');
  });

  it('keeps backticks and quotes in the title', () => {
    const t = 'An error thrown inside `use cache` loses its class, so every V&A failure became a 500';
    expect(parseFrictionLog(entryMd('2026-11-15 18:00', t))[0]!.title).toBe(t);
  });

  it('turns missing fields into empty strings', () => {
    const [e] = parseFrictionLog('## 2026-11-15 10:00: sparse\n\n- **Doing:** only this\n');
    expect(e).toEqual({
      timestamp: '2026-11-15 10:00',
      title: 'sparse',
      doing: 'only this',
      wentWrong: '',
      resolvedBy: '',
      prevention: '',
      caughtBy: '',
    });
  });

  it('gives an entry with a heading and no bullets all-empty fields', () => {
    const [e] = parseFrictionLog('## 2026-11-15 10:00: bare\n');
    expect(e).toMatchObject({ title: 'bare', doing: '', wentWrong: '', resolvedBy: '', prevention: '', caughtBy: '' });
  });

  it('joins continuation lines of a bullet with a single space', () => {
    const md = [
      '## 2026-11-15 10:00: multi',
      '',
      '- **Doing:** first line',
      '  second line',
      '  third line',
      '- **What went wrong:** one',
      '  two',
      '- **Caught by:** human',
    ].join('\n');
    const [e] = parseFrictionLog(md);
    expect(e!.doing).toBe('first line second line third line');
    expect(e!.wentWrong).toBe('one two');
    expect(e!.caughtBy).toBe('human');
  });

  it('does not let one entry bleed its last bullet into the next entry', () => {
    const md = entryMd('2026-11-15 10:00', 'a', 'hook') + '\n---\n\n' + entryMd('2026-11-15 11:00', 'b', 'CI');
    const entries = parseFrictionLog(md);
    expect(entries.find((e) => e.title === 'a')!.caughtBy).toBe('hook');
    expect(entries.find((e) => e.title === 'b')!.caughtBy).toBe('CI');
    expect(entries.find((e) => e.title === 'a')!.prevention).toBe('p');
  });

  it('sorts newest first', () => {
    const md = [
      entryMd('2026-11-15 10:00', 'old'),
      entryMd('2026-11-19 02:10', 'newest'),
      entryMd('2026-11-15 18:25', 'middle'),
    ].join('\n');
    expect(parseFrictionLog(md).map((e) => e.title)).toEqual(['newest', 'middle', 'old']);
  });

  it('sorts by time of day within one date', () => {
    const md = [entryMd('2026-11-15 09:05', 'early'), entryMd('2026-11-15 18:00', 'late')].join('\n');
    expect(parseFrictionLog(md).map((e) => e.title)).toEqual(['late', 'early']);
  });

  it('keeps file order for equal timestamps (stable sort)', () => {
    const md = [
      entryMd('2026-11-15 13:15', 'first'),
      entryMd('2026-11-15 13:15', 'second'),
      entryMd('2026-11-15 13:15', 'third'),
      entryMd('2026-11-15 14:00', 'later'),
    ].join('\n');
    expect(parseFrictionLog(md).map((e) => e.title)).toEqual(['later', 'first', 'second', 'third']);
  });

  it('works with CRLF line endings and no trailing newline', () => {
    const md = entryMd('2026-11-15 10:00', 'crlf').replace(/\n/g, '\r\n').trimEnd();
    const [e] = parseFrictionLog(md);
    expect(e!.title).toBe('crlf');
    expect(e!.caughtBy).toBe('human');
    expect(e!.doing).toBe('d crlf');
  });

  it('never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(() => parseFrictionLog(s)).not.toThrow();
      }),
      { numRuns: 300 },
    );
  });

  it('returns entries with string fields only, for markdown-shaped noise', () => {
    const token = fc.constantFrom(
      '## ',
      '2026-11-15 10:00: ',
      '- **Doing:** ',
      '- **Caught by:** ',
      '\n',
      'x',
      '```',
      '  ',
    );
    fc.assert(
      fc.property(fc.array(token, { maxLength: 30 }), (xs) => {
        for (const e of parseFrictionLog(xs.join(''))) {
          for (const v of Object.values(e)) expect(typeof v).toBe('string');
        }
      }),
      { numRuns: 300 },
    );
  });

  describe('against the real docs/friction-log.md', () => {
    const entries = parseFrictionLog(readFileSync(join(process.cwd(), 'docs', 'friction-log.md'), 'utf8'));

    it('finds all 30 entries logged so far (and never counts the summary or template)', () => {
      expect(entries.length).toBeGreaterThanOrEqual(30);
      expect(entries.every((e) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(e.timestamp))).toBe(true);
      expect(entries.some((e) => e.title.startsWith('Summary') || e.title === 'short title')).toBe(false);
    });

    it('is ordered newest first', () => {
      const ts = entries.map((e) => e.timestamp);
      expect(ts).toEqual([...ts].sort().reverse());
    });

    it('reads a known entry completely', () => {
      const e = entries.find((x) => x.title === "An edit script corrupted a file's encoding")!;
      expect(e).toBeDefined();
      expect(e.timestamp).toBe('2026-11-19 02:10');
      expect(e.doing).toBe('006-wall-preview, adding e2e tests with a Python script (several edits at once).');
      expect(e.caughtBy).toBe('agent itself');
      expect(e.resolvedBy.startsWith('The Read tool flagged the encoding.')).toBe(true);
      expect(e.prevention).toContain("open(p, encoding='utf-8', newline='')");
    });

    it('keeps the three 13:15 entries in file order', () => {
      const same = entries.filter((e) => e.timestamp === '2026-11-15 13:15').map((e) => e.title);
      expect(same).toEqual([
        'The 001 plan pre-decided the CORS spike outcome',
        'HSTS keyed on NODE_ENV, but local `next start` is production',
        'Other gaps in the 001 plan',
      ]);
    });

    it('has a non-empty caughtBy for every entry', () => {
      expect(entries.every((e) => e.caughtBy.length > 0)).toBe(true);
    });
  });
});

describe('tallyCaughtBy', () => {
  const e = (caughtBy: string) => ({
    timestamp: '2026-11-15 10:00',
    title: 't',
    doing: '',
    wentWrong: '',
    resolvedBy: '',
    prevention: '',
    caughtBy,
  });

  it('returns an empty list for no entries', () => {
    expect(tallyCaughtBy([])).toEqual([]);
  });

  it('counts each category', () => {
    expect(tallyCaughtBy([e('hook'), e('human'), e('hook'), e('hook')])).toEqual([
      { who: 'hook', count: 3 },
      { who: 'human', count: 1 },
    ]);
  });

  it('sorts by count descending', () => {
    const r = tallyCaughtBy([e('a'), e('b'), e('b'), e('c'), e('c'), e('c')]);
    expect(r.map((x) => x.who)).toEqual(['c', 'b', 'a']);
  });

  it('breaks ties by name ascending', () => {
    const r = tallyCaughtBy([e('zeta'), e('alpha'), e('mid')]);
    expect(r.map((x) => x.who)).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('normalises case and surrounding whitespace into one category', () => {
    expect(tallyCaughtBy([e('Human'), e(' human '), e('HUMAN\t')])).toEqual([{ who: 'human', count: 3 }]);
  });

  it('keeps a multi-word category whole and does not split on plus or slash', () => {
    const r = tallyCaughtBy([e('human plan review'), e('hook + human'), e('reviewer agent / CI')]);
    expect(r.map((x) => x.who).sort()).toEqual(['hook + human', 'human plan review', 'reviewer agent / ci']);
    expect(r.every((x) => x.count === 1)).toBe(true);
  });

  it('counts empty and whitespace-only values as unknown', () => {
    expect(tallyCaughtBy([e(''), e('   '), e('hook')])).toEqual([
      { who: 'unknown', count: 2 },
      { who: 'hook', count: 1 },
    ]);
  });

  it('merges a literal "unknown" with empty values', () => {
    expect(tallyCaughtBy([e(''), e('Unknown')])).toEqual([{ who: 'unknown', count: 2 }]);
  });

  it('has counts that sum to the number of entries', () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { maxLength: 30 }), (xs) => {
        const total = tallyCaughtBy(xs.map(e)).reduce((n, r) => n + r.count, 0);
        expect(total).toBe(xs.length);
      }),
    );
  });

  it('is sorted by count desc then name asc for any input', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('a', 'b', 'c', 'D', '', 'hook'), { maxLength: 40 }), (xs) => {
        const r = tallyCaughtBy(xs.map(e));
        for (let i = 1; i < r.length; i++) {
          const prev = r[i - 1]!;
          const cur = r[i]!;
          expect(prev.count > cur.count || (prev.count === cur.count && prev.who < cur.who)).toBe(true);
        }
      }),
    );
  });
});
