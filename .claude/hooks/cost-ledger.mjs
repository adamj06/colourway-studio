#!/usr/bin/env node
// SessionEnd: sum token usage per model from the session transcript and append to docs/cost/ledger.csv.
// Feeds the "How this was built" page. Cross-check totals with `npx ccusage` before the interview.
import { readFileSync, existsSync, appendFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const transcript = input.transcript_path;
if (!transcript || !existsSync(transcript)) process.exit(0);

// Collect the main transcript plus any subagent transcripts stored alongside it (best effort).
const files = [transcript];
const sidecar = transcript.replace(/\.jsonl$/, '');
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.jsonl')) files.push(p);
  }
};
if (existsSync(sidecar) && statSync(sidecar).isDirectory()) walk(sidecar);

// Dedupe by message id: streamed messages can appear on several lines.
const byId = new Map();
for (const f of files) {
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const m = e.message;
    if (e.type !== 'assistant' || !m?.usage || !m.model) continue;
    byId.set(m.id ?? `${f}:${byId.size}`, { model: m.model, u: m.usage });
  }
}

const totals = {};
for (const { model, u } of byId.values()) {
  const t = (totals[model] ??= { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
  t.input += u.input_tokens ?? 0;
  t.output += u.output_tokens ?? 0;
  t.cacheWrite += u.cache_creation_input_tokens ?? 0;
  t.cacheRead += u.cache_read_input_tokens ?? 0;
}

// Prices per million tokens, USD. Fill in from the official pricing page; leave null to skip the estimate.
let pricing = {};
const pricingFile = path.join(root, '.claude/hooks/pricing.json');
if (existsSync(pricingFile)) pricing = JSON.parse(readFileSync(pricingFile, 'utf8'));

const branch = spawnSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).stdout?.trim() || '';
const ledger = path.join(root, 'docs/cost/ledger.csv');
if (!existsSync(ledger)) {
  appendFileSync(ledger, 'timestamp,session_id,branch,model,input,output,cache_write,cache_read,est_usd\n');
}

const ts = new Date().toISOString();
for (const [model, t] of Object.entries(totals)) {
  const key = Object.keys(pricing).find((k) => model.includes(k));
  const p = key ? pricing[key] : null;
  const est =
    p && p.input != null
      ? (
          (t.input * p.input + t.output * p.output + t.cacheWrite * p.cacheWrite + t.cacheRead * p.cacheRead) /
          1e6
        ).toFixed(4)
      : '';
  appendFileSync(
    ledger,
    `${ts},${input.session_id ?? ''},${branch},${model},${t.input},${t.output},${t.cacheWrite},${t.cacheRead},${est}\n`,
  );
}
process.exit(0);
