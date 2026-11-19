import { z } from 'zod';

import { at } from '../text/safe';

const HEADER = 'timestamp,session_id,branch,model,input,output,cache_write,cache_read,est_usd';
const COLUMNS = 9;

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const timestamp = z.string().refine((s) => ISO_TIMESTAMP.test(s) && !Number.isNaN(Date.parse(s)));
const text = z.string().trim().min(1);
const count = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative());
const usd = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .transform(Number)
  .pipe(z.number().nonnegative());

const rowSchema = z
  .tuple([timestamp, text, text, text, count, count, count, count, usd])
  .transform(([ts, sessionId, branch, model, input, output, cacheWrite, cacheRead, estUsd]) => ({
    timestamp: ts,
    sessionId,
    branch,
    model,
    input,
    output,
    cacheWrite,
    cacheRead,
    estUsd,
  }));

export type LedgerRow = z.infer<typeof rowSchema>;

export interface LedgerParse {
  rows: LedgerRow[];
  skipped: number;
  headerError?: true;
}

export interface Totals {
  usd: number;
  outputTokens: number;
  sessions: number;
}

export interface CostSummary {
  total: Totals;
  byBranch: ({ branch: string } & Totals)[];
  byModel: ({ model: string } & Totals)[];
}

/** Parses the cost ledger. Never throws: bad rows are skipped and counted. */
export function parseLedger(csv: string): LedgerParse {
  const lines = csv.split(/\r?\n/);
  const dataLines = lines.slice(1).filter((line) => line.trim() !== '');

  if (at(lines, 0) !== HEADER) {
    return { rows: [], skipped: dataLines.length, headerError: true };
  }

  const rows: LedgerRow[] = [];
  for (const line of dataLines) {
    const cells = line.split(',');
    const parsed = cells.length === COLUMNS ? rowSchema.safeParse(cells) : undefined;
    if (parsed?.success) rows.push(parsed.data);
  }
  return { rows, skipped: dataLines.length - rows.length };
}

const roundToCents = (n: number): number => Math.round(n * 100) / 100;

function totalsOf(rows: readonly LedgerRow[]): Totals {
  let usd = 0;
  let outputTokens = 0;
  const sessions = new Set<string>();
  for (const row of rows) {
    usd += row.estUsd;
    outputTokens += row.output;
    sessions.add(row.sessionId);
  }
  return { usd: roundToCents(usd), outputTokens, sessions: sessions.size };
}

function groupBy(rows: readonly LedgerRow[], key: 'branch' | 'model'): Map<string, LedgerRow[]> {
  const groups = new Map<string, LedgerRow[]>();
  for (const row of rows) {
    const bucket = groups.get(row[key]);
    if (bucket) bucket.push(row);
    else groups.set(row[key], [row]);
  }
  return groups;
}

// Group names are unique, so two of them are never equal.
const byName = (a: string, b: string): number => (a < b ? -1 : 1);

export function summariseCost(rows: readonly LedgerRow[]): CostSummary {
  const byBranch = [...groupBy(rows, 'branch')]
    .map(([branch, group]) => ({ branch, ...totalsOf(group) }))
    .sort((a, b) => byName(a.branch, b.branch));
  const byModel = [...groupBy(rows, 'model')]
    .map(([model, group]) => ({ model, ...totalsOf(group) }))
    .sort((a, b) => b.usd - a.usd || byName(a.model, b.model));
  return { total: totalsOf(rows), byBranch, byModel };
}
