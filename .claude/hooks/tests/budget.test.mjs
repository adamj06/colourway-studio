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

// Session limits count weighted tokens: input + output + cacheWrite + 0.1 x cacheRead.
function usageTranscript(root, usage, count) {
  const lines = Array.from({ length: count }, (_, i) =>
    JSON.stringify({ type: 'assistant', message: { id: `u${i}`, model: 'claude-sonnet-x', usage } }),
  );
  const p = path.join(root, 'usage.jsonl');
  writeFileSync(p, lines.join('\n'));
  return p;
}
const limits = { ...base, sessionSoftTokens: 4000000, sessionHardTokens: 10000000, contextWarnTokens: 1e12 };

test('a cache-read-heavy session does NOT trip the hard limit', () => {
  const root = project({ budget: limits });
  // 100 calls x 110k cache-read = 11M raw tokens (over the 10M limit if counted in full), but about 1.1M weighted.
  const t = usageTranscript(root, { input_tokens: 500, output_tokens: 500, cache_read_input_tokens: 110000 }, 100);
  const r = run(root, t);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '', 'not even a soft-limit note');
});
test('cache reads count at one tenth', () => {
  const root = project({ budget: { ...limits, sessionSoftTokens: 1000000 } });
  // 5M cache-read = 500k weighted, under a 1M soft limit. 11M cache-read = 1.1M weighted, over it.
  assert.equal(run(root, usageTranscript(root, { cache_read_input_tokens: 5000000 }, 1)).stdout, '');
  assert.match(run(root, usageTranscript(root, { cache_read_input_tokens: 11000000 }, 1)).stdout, /weighted tokens/);
});
test('a genuinely heavy session still trips the hard limit', () => {
  const root = project({ budget: limits });
  // 10 calls x (600k input + 450k cache write + 200k output) = 12.5M weighted, with no cache reads at all.
  const t = usageTranscript(
    root,
    { input_tokens: 600000, cache_creation_input_tokens: 450000, output_tokens: 200000 },
    10,
  );
  const r = run(root, t);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /weighted tokens/);
});
test('heavy cache reads on top of real work still trip the hard limit', () => {
  const root = project({ budget: limits });
  // 10 x (900k input + 2M cache-read at 0.1) = 11M weighted.
  const t = usageTranscript(root, { input_tokens: 900000, cache_read_input_tokens: 2000000 }, 10);
  assert.equal(run(root, t).status, 2);
});
test('the block message says to ask Adam, not to edit the file', () => {
  const root = project({ budget: limits });
  const r = run(root, usageTranscript(root, { input_tokens: 11000000 }, 1));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /ask Adam to raise the limit/);
  assert.doesNotMatch(r.stderr, /Edit \.claude\/budget\.json/);
});
