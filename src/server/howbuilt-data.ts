import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parseAdrs, type Adr } from '@/lib/howbuilt/adr';
import { parseBuildLog, type BuildLogEntry } from '@/lib/howbuilt/buildLog';
import { parseFrictionLog, tallyCaughtBy, type FrictionEntry } from '@/lib/howbuilt/friction';
import { parseLedger, summariseCost, type CostSummary } from '@/lib/howbuilt/ledger';

export interface HowBuiltData {
  buildLog: BuildLogEntry[];
  adrs: Adr[];
  friction: FrictionEntry[];
  frictionTally: { who: string; count: number }[];
  cost: { summary: CostSummary; skipped: number };
}

/** Reads a repo file, naming it in the error. Synchronous, so the page prerenders at build time. */
function read(root: string, ...segments: string[]): string {
  const file = path.join(root, ...segments);
  try {
    return readFileSync(file, 'utf8');
  } catch (cause) {
    throw new Error(`how-built: cannot read ${segments.join('/')}`, { cause });
  }
}

function loadBuildLog(root: string): BuildLogEntry[] {
  let json: unknown;
  try {
    json = JSON.parse(read(root, 'data', 'build-log.json'));
  } catch (cause) {
    throw new Error('how-built: data/build-log.json is not valid JSON', { cause });
  }
  const result = parseBuildLog(json);
  if (!result.ok) throw new Error(`how-built: data/build-log.json is invalid:\n${result.error}`);
  return result.entries;
}

function loadAdrs(root: string): Adr[] {
  const dir = path.join(root, 'docs', 'adr');
  // Regular files only: a symlink named like an ADR must not pull in content from elsewhere.
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const files = names.map((filename) => ({ filename, content: read(root, 'docs', 'adr', filename) }));
  const { adrs, errors } = parseAdrs(files);
  if (errors.length > 0) throw new Error(`how-built: unreadable ADRs:\n${errors.join('\n')}`);
  return adrs;
}

/**
 * Loads everything the /how-built page shows. Called at build time only. Any invalid source throws,
 * which fails the build, so a broken log never ships half-rendered.
 */
export function loadHowBuilt(root: string = process.cwd()): HowBuiltData {
  const friction = parseFrictionLog(read(root, 'docs', 'friction-log.md'));
  // Zero entries means the heading format drifted, not that nothing went wrong. Fail loudly.
  if (friction.length === 0) throw new Error('how-built: docs/friction-log.md has no parseable entries');

  const ledger = parseLedger(read(root, 'docs', 'cost', 'ledger.csv'));
  if (ledger.headerError) throw new Error('how-built: docs/cost/ledger.csv has an unexpected header');

  return {
    buildLog: loadBuildLog(root),
    adrs: loadAdrs(root),
    friction,
    frictionTally: tallyCaughtBy(friction),
    cost: { summary: summariseCost(ledger.rows), skipped: ledger.skipped },
  };
}
