import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadHowBuilt } from './howbuilt-data';

const HEADER = 'timestamp,session_id,branch,model,input,output,cache_write,cache_read,est_usd';
const GOOD_ROW = '2026-11-15T13:55:38.460Z,s1,main,claude-opus-5-5,1,2,3,4,1.5';
const ENTRY = {
  id: '000-x',
  title: 'X',
  date: '2026-11-15',
  summary: 's',
  models: [],
  subagents: [],
  humanInterventions: [],
  reviewFindingsFixed: 0,
  prUrl: null,
};
const ADR = '# ADR 0001: Thing\n\n- **Status:** Accepted\n- **Date:** 2026-11-15\n\n## Context\n\nc\n';
const FRICTION = '## 2026-11-15 12:00: a thing\n\n- **Doing:** d\n- **Caught by:** human\n';

let root: string;

function write(rel: string, content: string): void {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function writeValidTree(over: Partial<Record<'log' | 'adr' | 'friction' | 'ledger', string>> = {}): void {
  write('data/build-log.json', over.log ?? JSON.stringify([ENTRY]));
  write('docs/adr/0000-template.md', '# ADR NNNN: Title\n');
  write('docs/adr/0001-thing.md', over.adr ?? ADR);
  write('docs/friction-log.md', over.friction ?? FRICTION);
  write('docs/cost/ledger.csv', over.ledger ?? `${HEADER}\n${GOOD_ROW}\n`);
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'howbuilt-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('loadHowBuilt', () => {
  it('loads all four sources from a repo root', () => {
    writeValidTree();
    const data = loadHowBuilt(root);
    expect(data.buildLog.map((e) => e.id)).toEqual(['000-x']);
    expect(data.adrs.map((a) => a.number)).toEqual([1]);
    expect(data.friction.map((f) => f.title)).toEqual(['a thing']);
    expect(data.frictionTally).toEqual([{ who: 'human', count: 1 }]);
    expect(data.cost.summary.total).toEqual({ usd: 1.5, outputTokens: 2, sessions: 1 });
    expect(data.cost.skipped).toBe(0);
  });

  it('counts skipped ledger rows instead of failing', () => {
    writeValidTree({ ledger: `${HEADER}\n${GOOD_ROW}\nbad row\n` });
    const data = loadHowBuilt(root);
    expect(data.cost.skipped).toBe(1);
    expect(data.cost.summary.total.sessions).toBe(1);
  });

  it('loads the real repository', () => {
    const data = loadHowBuilt();
    expect(data.buildLog.length).toBeGreaterThan(0);
    expect(data.adrs.length).toBeGreaterThan(0);
    expect(data.friction.length).toBeGreaterThan(0);
    expect(data.cost.summary.total.usd).toBeGreaterThan(0);
  });

  it('fails with the failing path when the build log is invalid', () => {
    writeValidTree({ log: JSON.stringify([ENTRY, { ...ENTRY, reviewFindingsFixed: -1 }]) });
    expect(() => loadHowBuilt(root)).toThrow(/build-log\.json[\s\S]*\[1\]\.reviewFindingsFixed/);
  });

  it('fails when the build log is not JSON', () => {
    writeValidTree({ log: '{ nope' });
    expect(() => loadHowBuilt(root)).toThrow(/build-log\.json/);
  });

  it('fails when an ADR cannot be parsed, naming the file', () => {
    writeValidTree({ adr: 'no title here' });
    expect(() => loadHowBuilt(root)).toThrow(/0001-thing\.md/);
  });

  it('fails when the ledger header is wrong', () => {
    writeValidTree({ ledger: `nope\n${GOOD_ROW}\n` });
    expect(() => loadHowBuilt(root)).toThrow(/ledger/);
  });

  it('fails when the friction log yields no entries (format drift)', () => {
    writeValidTree({ friction: '# Friction log\n\nnothing parseable\n' });
    expect(() => loadHowBuilt(root)).toThrow(/friction/);
  });

  it('fails when a source file is missing', () => {
    writeValidTree();
    rmSync(path.join(root, 'docs/friction-log.md'));
    expect(() => loadHowBuilt(root)).toThrow(/friction-log\.md/);
  });
});
