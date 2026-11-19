// Feature 007 (how-built): expects `src/lib/howbuilt/buildLog.ts` to export
//   parseBuildLog(input: unknown): { ok: true; entries: BuildLogEntry[] } | { ok: false; error: string }
// The real data/build-log.json is a BARE ARRAY of entries (not an object wrapper).
// Error strings name the failing path with bracket indices, e.g. `[2].reviewFindingsFixed`
// (an `entries[2]...` prefix is also fine, so the tests only match the `[2].field` part).
// Unknown extra fields are REJECTED (strict), so a typo in the log fails the build rather than being dropped.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parseBuildLog } from './buildLog';

const entry = (over: Record<string, unknown> = {}) => ({
  id: '006-wall-preview',
  title: 'Wall preview',
  date: '2026-11-19',
  summary: 'The recoloured design tiled on a wall.',
  models: ['claude-opus-5-5', 'claude-sonnet-5-5'],
  subagents: ['test-writer'],
  humanInterventions: ['Adam asked for the region picker.'],
  reviewFindingsFixed: 3,
  prUrl: 'https://github.com/adamj06/colourway-studio/pull/16',
  ...over,
});

const without = (key: string) => Object.fromEntries(Object.entries(entry()).filter(([k]) => k !== key));

function fail(input: unknown): string {
  const r = parseBuildLog(input);
  if (r.ok) throw new Error('expected ok:false');
  return r.error;
}

describe('parseBuildLog: accepting good input', () => {
  it('accepts an empty array with no entries', () => {
    expect(parseBuildLog([])).toEqual({ ok: true, entries: [] });
  });

  it('accepts one valid entry and returns it unchanged', () => {
    const e = entry();
    expect(parseBuildLog([e])).toEqual({ ok: true, entries: [e] });
  });

  it('accepts a null prUrl, empty arrays and zero findings', () => {
    const e = entry({ prUrl: null, models: [], subagents: [], humanInterventions: [], reviewFindingsFixed: 0 });
    expect(parseBuildLog([e])).toEqual({ ok: true, entries: [e] });
  });

  it('keeps entries in the order given', () => {
    const r = parseBuildLog([entry({ id: 'b' }), entry({ id: 'a' })]);
    expect(r.ok && r.entries.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('accepts the real data/build-log.json', () => {
    const raw: unknown = JSON.parse(readFileSync(join(process.cwd(), 'data', 'build-log.json'), 'utf8'));
    const r = parseBuildLog(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries.length).toBeGreaterThanOrEqual(7);
    expect(r.entries[0]).toMatchObject({
      id: '000-guardrails',
      title: 'Guardrails before code',
      date: '2026-11-15',
      models: ['claude-opus-5-5'],
      subagents: [],
      reviewFindingsFixed: 0,
      prUrl: null,
    });
    const wall = r.entries.find((e) => e.id === '006-wall-preview');
    expect(wall?.prUrl).toBe('https://github.com/adamj06/colourway-studio/pull/16');
  });
});

describe('parseBuildLog: rejecting bad input with the failing path in the error', () => {
  it('rejects a negative reviewFindingsFixed and names entry 2 and the field', () => {
    const err = fail([entry(), entry(), entry({ reviewFindingsFixed: -1 })]);
    expect(err).toMatch(/\[2\]\.reviewFindingsFixed/);
  });

  it('rejects a fractional reviewFindingsFixed', () => {
    expect(fail([entry({ reviewFindingsFixed: 1.5 })])).toMatch(/\[0\]\.reviewFindingsFixed/);
  });

  it('rejects a reviewFindingsFixed given as a string', () => {
    expect(fail([entry({ reviewFindingsFixed: '3' })])).toMatch(/\[0\]\.reviewFindingsFixed/);
  });

  it('rejects an entry with a missing title and names it', () => {
    const rest = without('title');
    expect(fail([entry(), rest])).toMatch(/\[1\]\.title/);
  });

  it('rejects a bad date format', () => {
    for (const date of ['15/11/2026', '2026-1-5', '2026-11-15T10:00:00Z', 'yesterday', '', '2026-13-01']) {
      expect(fail([entry({ date })])).toMatch(/\[0\]\.date/);
    }
  });

  it('rejects a javascript: prUrl', () => {
    expect(fail([entry({ prUrl: 'javascript:alert(1)' })])).toMatch(/\[0\]\.prUrl/);
  });

  it('rejects an http (not https) prUrl and other non-https values', () => {
    for (const prUrl of [
      'http://github.com/a/b/pull/1',
      'data:text/html,x',
      'ftp://x.example',
      '//evil.example',
      'not a url',
      '',
    ]) {
      expect(fail([entry({ prUrl })])).toMatch(/\[0\]\.prUrl/);
    }
  });

  it('rejects an unknown extra field (strict) and names the entry and the key', () => {
    const err = fail([entry({ colour: 'red' })]);
    expect(err).toMatch(/\[0\]/);
    expect(err).toContain('colour');
  });

  it('rejects models that are not an array of strings', () => {
    expect(fail([entry({ models: 'claude-opus-5-5' })])).toMatch(/\[0\]\.models/);
    expect(fail([entry({ models: [1] })])).toMatch(/\[0\]\.models/);
  });

  it('rejects a missing prUrl key (null must be explicit)', () => {
    const rest = without('prUrl');
    expect(fail([rest])).toMatch(/\[0\]\.prUrl/);
  });

  it('rejects a non-array top level', () => {
    for (const bad of [null, undefined, 42, 'x', {}, { entries: [entry()] }]) {
      expect(parseBuildLog(bad).ok).toBe(false);
    }
  });

  it('rejects a non-object entry', () => {
    expect(fail([null])).toMatch(/\[0\]/);
    expect(fail(['x'])).toMatch(/\[0\]/);
  });

  it('returns a non-empty error string on failure', () => {
    expect(fail([{}]).length).toBeGreaterThan(0);
  });
});

describe('parseBuildLog: never throws (property)', () => {
  it('returns a result for any value', () => {
    fc.assert(
      fc.property(fc.anything(), (v) => {
        expect(typeof parseBuildLog(v).ok).toBe('boolean');
      }),
      { numRuns: 300 },
    );
  });

  it('accepts any non-negative integer finding count', () => {
    fc.assert(
      fc.property(fc.nat(), fc.constantFrom(null, 'https://github.com/a/b/pull/9'), (n, prUrl) => {
        expect(parseBuildLog([entry({ reviewFindingsFixed: n, prUrl })]).ok).toBe(true);
      }),
    );
  });

  it('rejects any negative integer finding count', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: -1 }), (n) => {
        expect(parseBuildLog([entry({ reviewFindingsFixed: n })]).ok).toBe(false);
      }),
    );
  });
});
