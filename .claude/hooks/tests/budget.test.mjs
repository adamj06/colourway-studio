import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

const hooksDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function project({ budget, pricing }) {
  const root = mkdtempSync(path.join(tmpdir(), 'budget-'));
  mkdirSync(path.join(root, '.claude/hooks'), { recursive: true });
  cpSync(hooksDir, path.join(root, '.claude/hooks'), { recursive: true });
  writeFileSync(path.join(root, '.claude/budget.json'), JSON.stringify(budget));
  writeFileSync(path.join(root, '.claude/hooks/pricing.json'), JSON.stringify(pricing ?? {}));
  return root;
}
function transcript(root, inputTokensPerMsg, count) {
  const lines = Array.from({ length: count }, (_, i) =>
    JSON.stringify({
      type: 'assistant',
      message: {
        id: `m${i}`,
        model: 'claude-sonnet-x',
        usage: { input_tokens: inputTokensPerMsg, output_tokens: 1000 },
      },
    }),
  );
  const p = path.join(root, 't.jsonl');
  writeFileSync(p, lines.join('\n'));
  return p;
}
const run = (root, transcript_path) =>
  spawnSync(process.execPath, [path.join(root, '.claude/hooks/budget.mjs')], {
    input: JSON.stringify({ transcript_path }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });

const base = {
  sessionSoftTokens: 100000,
  sessionHardTokens: 1000000,
  contextWarnTokens: 120000,
  dailySoftUsd: 1,
  dailyHardUsd: 2,
};

test('quiet when usage is low', () => {
  const root = project({ budget: base });
  const r = run(root, transcript(root, 1000, 3));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});
test('warns when context is large', () => {
  const root = project({ budget: base });
  const r = run(root, transcript(root, 150000, 1));
  assert.equal(r.status, 0);
  assert.match(r.stdout, /compact/);
});
test('blocks over the session token hard limit', () => {
  const root = project({ budget: base });
  assert.equal(run(root, transcript(root, 600000, 2)).status, 2);
});
test('blocks over the daily USD hard limit when priced', () => {
  const root = project({
    budget: { ...base, sessionHardTokens: 1e12 },
    pricing: { sonnet: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 } },
  });
  assert.equal(run(root, transcript(root, 400000, 2)).status, 2); // ~ $2.43
});
test('ignores USD limits when pricing is not filled in', () => {
  const root = project({
    budget: { ...base, sessionHardTokens: 1e12, sessionSoftTokens: 1e12, contextWarnTokens: 1e12 },
  });
  assert.equal(run(root, transcript(root, 400000, 2)).status, 0);
});
