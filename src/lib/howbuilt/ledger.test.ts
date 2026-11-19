// Feature 007 (how-built): expects `src/lib/howbuilt/ledger.ts` to export
//   parseLedger(csv: string): { rows: LedgerRow[]; skipped: number; headerError?: true }
//   summariseCost(rows: LedgerRow[]): { total: Totals; byBranch: ({ branch } & Totals)[]; byModel: ({ model } & Totals)[] }
// LedgerRow = { timestamp: string, sessionId, branch, model, input, output, cacheWrite, cacheRead, estUsd }
//   (camelCase of the CSV columns session_id, cache_write, cache_read, est_usd; numbers are numbers).
// Header must equal `timestamp,session_id,branch,model,input,output,cache_write,cache_read,est_usd` exactly
//   (a CRLF-terminated header is fine). Otherwise parseLedger does not throw and returns
//   { rows: [], skipped: <number of non-blank data lines>, headerError: true }.
//   An empty string has no header, so it is also headerError:true with skipped 0.
//   On a good header `headerError` is absent (falsy).
// Totals = { usd (rounded to 2dp from the UNROUNDED sum), outputTokens, sessions (distinct session_id) }.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parseLedger, summariseCost } from './ledger';

const HEADER = 'timestamp,session_id,branch,model,input,output,cache_write,cache_read,est_usd';

// Real rows copied from docs/cost/ledger.csv
const R1 =
  '2026-11-15T13:55:38.460Z,2d24fc97-2253-4723-8b42-c0d5b371d1cf,feat/001-tooling,claude-opus-5-5,64,30097,123599,1745920,1.5694';
const R2 =
  '2026-11-15T13:55:38.460Z,2d24fc97-2253-4723-8b42-c0d5b371d1cf,feat/001-tooling,claude-sonnet-5-5,168,88364,219191,9606892,3.3533';
const R3 =
  '2026-11-15T16:47:55.647Z,8cc42dba-0c5a-428f-8a65-f9b16a359846,main,claude-sonnet-5-5,291,184231,376221,20033917,6.7902';
const R4 =
  '2026-11-15T16:47:55.647Z,8cc42dba-0c5a-428f-8a65-f9b16a359846,main,claude-opus-5-5,116,76646,207205,3703272,3.3101';

const csv = (...lines: string[]) => [HEADER, ...lines].join('\n') + '\n';

describe('parseLedger: good input', () => {
  it('parses a real row into typed fields', () => {
    const { rows, skipped } = parseLedger(csv(R1));
    expect(skipped).toBe(0);
    expect(rows).toEqual([
      {
        timestamp: '2026-11-15T13:55:38.460Z',
        sessionId: '2d24fc97-2253-4723-8b42-c0d5b371d1cf',
        branch: 'feat/001-tooling',
        model: 'claude-opus-5-5',
        input: 64,
        output: 30097,
        cacheWrite: 123599,
        cacheRead: 1745920,
        estUsd: 1.5694,
      },
    ]);
  });

  it('keeps rows in file order', () => {
    const { rows } = parseLedger(csv(R1, R2, R3, R4));
    expect(rows.map((r) => r.output)).toEqual([30097, 88364, 184231, 76646]);
  });

  it('returns no rows and nothing skipped for a header only', () => {
    expect(parseLedger(HEADER + '\n')).toEqual({ rows: [], skipped: 0 });
    expect(parseLedger(HEADER)).toEqual({ rows: [], skipped: 0 });
  });

  it('does not count blank trailing lines as skipped', () => {
    expect(parseLedger(csv(R1) + '\n\n\n')).toMatchObject({ skipped: 0 });
    expect(parseLedger(csv(R1) + '\n\n\n').rows).toHaveLength(1);
    expect(parseLedger(csv(R1) + '   \n').skipped).toBe(0);
  });

  it('works with CRLF line endings', () => {
    const r = parseLedger([HEADER, R1, R2, ''].join('\r\n'));
    expect(r.skipped).toBe(0);
    expect(r.headerError).toBeFalsy();
    expect(r.rows).toHaveLength(2);
    expect(r.rows[1]!.estUsd).toBe(3.3533);
    expect(r.rows[1]!.model).toBe('claude-sonnet-5-5');
  });

  it('accepts zero token counts and zero cost', () => {
    const { rows, skipped } = parseLedger(csv('2026-11-15T13:55:38.460Z,s1,main,m,0,0,0,0,0'));
    expect(skipped).toBe(0);
    expect(rows[0]).toMatchObject({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, estUsd: 0 });
  });

  it('accepts an integer est_usd', () => {
    expect(parseLedger(csv('2026-11-15T13:55:38.460Z,s1,main,m,1,2,3,4,12')).rows[0]!.estUsd).toBe(12);
  });

  it('parses the real docs/ledger.csv without a header error and without skipping rows', () => {
    const r = parseLedger(readFileSync(join(process.cwd(), 'docs', 'cost', 'ledger.csv'), 'utf8'));
    expect(r.headerError).toBeFalsy();
    expect(r.skipped).toBe(0);
    expect(r.rows.length).toBeGreaterThanOrEqual(23);
    expect(r.rows[0]).toMatchObject({ branch: 'feat/001-tooling', model: 'claude-opus-5-5', output: 30097 });
  });
});

describe('parseLedger: malformed rows are skipped and counted', () => {
  const skipCase = (name: string, line: string) => {
    it(`skips ${name}`, () => {
      const r = parseLedger(csv(R1, line, R2));
      expect(r.rows).toHaveLength(2);
      expect(r.skipped).toBe(1);
      expect(r.headerError).toBeFalsy();
    });
  };

  skipCase('a row with too few columns', '2026-11-15T13:55:38.460Z,s1,main,m,1,2,3,4');
  skipCase('a row with too many columns', '2026-11-15T13:55:38.460Z,s1,main,m,1,2,3,4,5.5,extra');
  skipCase('a row with an invalid timestamp', 'yesterday,s1,main,m,1,2,3,4,0.5');
  skipCase('a row with an impossible date', '2026-13-45T00:00:00.000Z,s1,main,m,1,2,3,4,0.5');
  skipCase('a row with an empty timestamp', ',s1,main,m,1,2,3,4,0.5');
  skipCase('a row with an empty session id', '2026-11-15T13:55:38.460Z,,main,m,1,2,3,4,0.5');
  skipCase('a row with an empty branch', '2026-11-15T13:55:38.460Z,s1,,m,1,2,3,4,0.5');
  skipCase('a row with an empty model', '2026-11-15T13:55:38.460Z,s1,main,,1,2,3,4,0.5');
  skipCase('a row with a negative token count', '2026-11-15T13:55:38.460Z,s1,main,m,-1,2,3,4,0.5');
  skipCase('a row with a fractional token count', '2026-11-15T13:55:38.460Z,s1,main,m,1,2.5,3,4,0.5');
  skipCase('a row with a non-numeric token count', '2026-11-15T13:55:38.460Z,s1,main,m,1,abc,3,4,0.5');
  skipCase('a row with an empty token count', '2026-11-15T13:55:38.460Z,s1,main,m,1,,3,4,0.5');
  skipCase('a row with a NaN cost', '2026-11-15T13:55:38.460Z,s1,main,m,1,2,3,4,NaN');
  skipCase('a row with an infinite cost', '2026-11-15T13:55:38.460Z,s1,main,m,1,2,3,4,Infinity');
  skipCase('a row with a negative cost', '2026-11-15T13:55:38.460Z,s1,main,m,1,2,3,4,-0.01');
  skipCase('a row with an empty cost', '2026-11-15T13:55:38.460Z,s1,main,m,1,2,3,4,');
  skipCase('a row that is only commas', ',,,,,,,,');
  skipCase('a row of plain text', 'not a csv row at all');

  it('counts several bad rows', () => {
    const r = parseLedger(csv('bad', R1, 'worse,1,2', R2, ',,,,,,,,'));
    expect(r.rows).toHaveLength(2);
    expect(r.skipped).toBe(3);
  });

  it('skips a bad row but keeps blank trailing lines uncounted', () => {
    const r = parseLedger(csv(R1, 'bad') + '\n\n');
    expect(r.skipped).toBe(1);
    expect(r.rows).toHaveLength(1);
  });
});

describe('parseLedger: header problems', () => {
  it('reports a headerError and skips every data line when the header is wrong', () => {
    const r = parseLedger(
      ['timestamp,session,branch,model,input,output,cache_write,cache_read,est_usd', R1, R2].join('\n'),
    );
    expect(r).toEqual({ rows: [], skipped: 2, headerError: true });
  });

  it('reports a headerError for a reordered header', () => {
    const r = parseLedger(
      ['session_id,timestamp,branch,model,input,output,cache_write,cache_read,est_usd', R1].join('\n'),
    );
    expect(r).toEqual({ rows: [], skipped: 1, headerError: true });
  });

  it('reports a headerError for a header with a missing column', () => {
    const r = parseLedger(['timestamp,session_id,branch,model,input,output,cache_write,cache_read', R1].join('\n'));
    expect(r.headerError).toBe(true);
    expect(r.rows).toEqual([]);
  });

  it('reports a headerError when the first line is a data row (no header)', () => {
    expect(parseLedger([R1, R2].join('\n'))).toEqual({ rows: [], skipped: 1, headerError: true });
  });

  it('does not count blank lines as skipped when the header is wrong', () => {
    expect(parseLedger('nope\n' + R1 + '\n\n\n')).toEqual({ rows: [], skipped: 1, headerError: true });
  });

  it('reports a headerError and skipped 0 for an empty string', () => {
    expect(parseLedger('')).toEqual({ rows: [], skipped: 0, headerError: true });
  });
});

describe('parseLedger: never throws (property)', () => {
  it('returns a well-formed result for any string', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const r = parseLedger(s);
        expect(Array.isArray(r.rows)).toBe(true);
        expect(Number.isInteger(r.skipped) && r.skipped >= 0).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('accounts for every non-blank data line as either a row or a skip', () => {
    const cell = fc.constantFrom('', 'x', '-1', '1', '1.5', 'NaN', '2026-11-15T13:55:38.460Z', 's1');
    const line = fc.array(cell, { minLength: 1, maxLength: 11 }).map((c) => c.join(','));
    fc.assert(
      fc.property(fc.array(line, { maxLength: 12 }), (lines) => {
        const nonBlank = lines.filter((l) => l.replace(/,/g, '').trim() !== '' || l.includes(',')).length;
        const r = parseLedger(csv(...lines));
        expect(r.rows.length + r.skipped).toBe(lines.filter((l) => l.trim() !== '').length);
        expect(nonBlank).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('every parsed row has non-negative integer tokens and a non-negative finite cost', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        for (const row of parseLedger(HEADER + '\n' + s).rows) {
          for (const n of [row.input, row.output, row.cacheWrite, row.cacheRead]) {
            expect(Number.isInteger(n) && n >= 0).toBe(true);
          }
          expect(Number.isFinite(row.estUsd) && row.estUsd >= 0).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('summariseCost', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    timestamp: '2026-11-15T13:55:38.460Z',
    sessionId: 's1',
    branch: 'main',
    model: 'm1',
    input: 1,
    output: 10,
    cacheWrite: 1,
    cacheRead: 1,
    estUsd: 1,
    ...over,
  });
  const parsed = (...lines: string[]) => parseLedger(csv(...lines)).rows;

  it('returns zero totals and empty groups for no rows', () => {
    expect(summariseCost([])).toEqual({
      total: { usd: 0, outputTokens: 0, sessions: 0 },
      byBranch: [],
      byModel: [],
    });
  });

  it('totals real rows: usd to cents, output tokens, distinct sessions', () => {
    const { total } = summariseCost(parsed(R1, R2, R3, R4));
    expect(total.usd).toBe(15.02); // 1.5694 + 3.3533 + 6.7902 + 3.3101 = 15.023
    expect(total.outputTokens).toBe(30097 + 88364 + 184231 + 76646);
    expect(total.sessions).toBe(2);
  });

  it('counts a session once even when it has several model rows', () => {
    const { total } = summariseCost([row({ model: 'a' }), row({ model: 'b' }), row({ model: 'c' })]);
    expect(total.sessions).toBe(1);
  });

  it('counts different session ids separately', () => {
    expect(
      summariseCost([row({ sessionId: 'a' }), row({ sessionId: 'b' }), row({ sessionId: 'a' })]).total.sessions,
    ).toBe(2);
  });

  it('rounds the sum, not the sum of rounded values (0.333 x 3 is 1.00, not 0.99)', () => {
    const rows = [row({ estUsd: 0.333 }), row({ estUsd: 0.333 }), row({ estUsd: 0.333 })];
    expect(summariseCost(rows).total.usd).toBe(1);
  });

  it('rounds the sum, not the sum of rounded values (0.004 x 3 is 0.01, not 0)', () => {
    const rows = [row({ estUsd: 0.004 }), row({ estUsd: 0.004 }), row({ estUsd: 0.004 })];
    expect(summariseCost(rows).total.usd).toBe(0.01);
  });

  it('rounds per group from the unrounded group sum too', () => {
    const rows = [
      row({ branch: 'b', model: 'x', estUsd: 0.333 }),
      row({ branch: 'b', model: 'x', estUsd: 0.333 }),
      row({ branch: 'b', model: 'x', estUsd: 0.333 }),
    ];
    const s = summariseCost(rows);
    expect(s.byBranch[0]!.usd).toBe(1);
    expect(s.byModel[0]!.usd).toBe(1);
  });

  it('rounds to two decimal places down as well as up', () => {
    expect(summariseCost([row({ estUsd: 1.234 })]).total.usd).toBe(1.23);
    expect(summariseCost([row({ estUsd: 1.236 })]).total.usd).toBe(1.24);
  });

  it('groups by branch with per-branch totals, sorted by branch name', () => {
    const { byBranch } = summariseCost(parsed(R3, R4, R1, R2));
    expect(byBranch).toEqual([
      { branch: 'feat/001-tooling', usd: 4.92, outputTokens: 118461, sessions: 1 },
      { branch: 'main', usd: 10.1, outputTokens: 260877, sessions: 1 },
    ]);
  });

  it('sorts branches by name ascending, not by first appearance or cost', () => {
    const rows = [
      row({ branch: 'zeta', estUsd: 9 }),
      row({ branch: 'alpha', estUsd: 1 }),
      row({ branch: 'main', estUsd: 5 }),
    ];
    expect(summariseCost(rows).byBranch.map((b) => b.branch)).toEqual(['alpha', 'main', 'zeta']);
  });

  it('groups by model, sorted by usd descending', () => {
    const { byModel } = summariseCost(parsed(R1, R2, R3, R4));
    expect(byModel.map((m) => m.model)).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5']);
    expect(byModel[0]).toEqual({ model: 'claude-sonnet-5-5', usd: 10.14, outputTokens: 88364 + 184231, sessions: 2 });
    expect(byModel[1]!.outputTokens).toBe(30097 + 76646);
    expect(byModel[1]!.sessions).toBe(2);
  });

  it('orders models by usd descending even when the cheaper one appears first', () => {
    const rows = [
      row({ model: 'cheap', estUsd: 1 }),
      row({ model: 'dear', estUsd: 50 }),
      row({ model: 'mid', estUsd: 7 }),
    ];
    expect(summariseCost(rows).byModel.map((m) => m.model)).toEqual(['dear', 'mid', 'cheap']);
  });

  it('counts distinct sessions within a group, not across all rows', () => {
    const rows = [
      row({ branch: 'a', sessionId: 's1' }),
      row({ branch: 'a', sessionId: 's1' }),
      row({ branch: 'b', sessionId: 's1' }),
      row({ branch: 'b', sessionId: 's2' }),
    ];
    const s = summariseCost(rows);
    expect(s.byBranch).toMatchObject([
      { branch: 'a', sessions: 1 },
      { branch: 'b', sessions: 2 },
    ]);
    expect(s.total.sessions).toBe(2);
  });

  it('does not mutate the input rows array order', () => {
    const rows = [row({ branch: 'z', model: 'a', estUsd: 1 }), row({ branch: 'a', model: 'b', estUsd: 2 })];
    const copy = rows.map((r) => ({ ...r }));
    summariseCost(rows);
    expect(rows).toEqual(copy);
  });

  it('has group usd within a cent per group of the total and group output tokens summing to the total', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            branch: fc.constantFrom('a', 'b', 'c'),
            model: fc.constantFrom('m1', 'm2'),
            sessionId: fc.constantFrom('s1', 's2', 's3'),
            output: fc.nat(100000),
            estUsd: fc.double({ min: 0, max: 100, noNaN: true }),
          }),
          { maxLength: 25 },
        ),
        (parts) => {
          const rows = parts.map((p) => row(p));
          const s = summariseCost(rows);
          expect(s.byBranch.reduce((n, b) => n + b.outputTokens, 0)).toBe(s.total.outputTokens);
          expect(s.byModel.reduce((n, b) => n + b.outputTokens, 0)).toBe(s.total.outputTokens);
          expect(Math.abs(s.byBranch.reduce((n, b) => n + b.usd, 0) - s.total.usd)).toBeLessThanOrEqual(
            0.005 * s.byBranch.length + 1e-9,
          );
          expect(s.total.sessions).toBe(new Set(rows.map((r) => r.sessionId)).size);
          for (let i = 1; i < s.byModel.length; i++)
            expect(s.byModel[i - 1]!.usd).toBeGreaterThanOrEqual(s.byModel[i]!.usd);
          expect(s.byBranch.map((b) => b.branch)).toEqual([...s.byBranch.map((b) => b.branch)].sort());
        },
      ),
    );
  });

  it('gives usd with at most two decimal places', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 50, noNaN: true }), { maxLength: 20 }), (xs) => {
        const usd = summariseCost(xs.map((estUsd) => row({ estUsd }))).total.usd;
        expect(Math.abs(usd * 100 - Math.round(usd * 100))).toBeLessThan(1e-6);
      }),
    );
  });
});
