#!/usr/bin/env node
// UserPromptSubmit: spend and context guardrail, checked before every prompt.
// Hard limit -> exit 2 (prompt blocked, reason shown). Soft limit or a big context -> a note is added for Claude to relay.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readJson, transcriptUsage, totalTokens, contextTokens, estimateUsd, ledgerUsdToday } from './lib-usage.mjs';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const budget = readJson(path.join(root, '.claude/budget.json'));
const pricing = readJson(path.join(root, '.claude/hooks/pricing.json'));

const { messages, last } = transcriptUsage(input.transcript_path);
const sessionTokens = messages.reduce((s, m) => s + totalTokens(m.u), 0);
const sessionUsdParts = messages.map((m) => estimateUsd(m.model, m.u, pricing));
const priced = sessionUsdParts.every((x) => x != null) && messages.length > 0;
const sessionUsd = priced ? sessionUsdParts.reduce((a, b) => a + b, 0) : null;
const dayUsd = ledgerUsdToday(root) + (sessionUsd ?? 0);
const ctx = contextTokens(last?.u);

const fmt = (n) => n.toLocaleString('en-GB');
const where = 'Edit .claude/budget.json if this is deliberate.';

if (priced && budget.dailyHardUsd && dayUsd >= budget.dailyHardUsd) {
  process.stderr.write(`Budget guard: today's spend is about $${dayUsd.toFixed(2)}, over the hard limit of $${budget.dailyHardUsd}. ${where}`);
  process.exit(2);
}
if (budget.sessionHardTokens && sessionTokens >= budget.sessionHardTokens) {
  process.stderr.write(`Budget guard: this session has used ${fmt(sessionTokens)} tokens, over the hard limit. Start a fresh session (/clear) or ${where}`);
  process.exit(2);
}

const notes = [];
if (priced && budget.dailySoftUsd && dayUsd >= budget.dailySoftUsd) {
  notes.push(`today's spend is about $${dayUsd.toFixed(2)} (soft limit $${budget.dailySoftUsd})`);
}
if (budget.sessionSoftTokens && sessionTokens >= budget.sessionSoftTokens) {
  notes.push(`this session has used ${fmt(sessionTokens)} tokens`);
}
if (budget.contextWarnTokens && ctx >= budget.contextWarnTokens) {
  notes.push(`context is at ${fmt(ctx)} tokens, so suggest /compact or /clear before the next big task`);
}
if (notes.length) {
  // stdout from UserPromptSubmit is added to Claude's context.
  process.stdout.write(`[budget-guard] Mention this to Adam briefly at the start of your reply: ${notes.join('; ')}.`);
}
process.exit(0);
