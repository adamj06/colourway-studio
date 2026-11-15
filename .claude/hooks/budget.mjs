#!/usr/bin/env node
// UserPromptSubmit: spend and context guardrail, checked before every prompt.
// Hard limit -> exit 2 (prompt blocked, reason shown) for prompts a human typed. Soft limit or a big context -> a note
// is added for Claude to relay.
//
// System deliveries (a finished background task or a subagent's report, which start with <task-notification> or
// <agent-message) are never blocked: the tokens were already spent, so blocking saves nothing and throws the finished
// work away. They only get the note. This is a spend guard for Adam's own prompts, not a security boundary, so a human
// who types one of those prefixes only lets themselves past their own limit.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readJson, transcriptUsage, weightedTokens, contextTokens, estimateUsd, ledgerUsdToday } from './lib-usage.mjs';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const budget = readJson(path.join(root, '.claude/budget.json'));
const pricing = readJson(path.join(root, '.claude/hooks/pricing.json'));

const { messages, last } = transcriptUsage(input.transcript_path);
const sessionTokens = Math.round(messages.reduce((s, m) => s + weightedTokens(m.u), 0));
const sessionUsdParts = messages.map((m) => estimateUsd(m.model, m.u, pricing));
const priced = sessionUsdParts.every((x) => x != null) && messages.length > 0;
const sessionUsd = priced ? sessionUsdParts.reduce((a, b) => a + b, 0) : null;
const dayUsd = ledgerUsdToday(root) + (sessionUsd ?? 0);
const ctx = contextTokens(last?.u);

const prompt = typeof input.prompt === 'string' ? input.prompt.trimStart() : '';
const isSystemDelivery = /^<(task-notification|agent-message)[\s>]/.test(prompt);

const fmt = (n) => n.toLocaleString('en-GB');
const where = 'If you need more headroom, ask Adam to raise the limit.';
const letThrough = "this delivery was let through; Adam's own prompts stay blocked until the limit is raised";

const notes = [];
const overDailyHard = Boolean(priced && budget.dailyHardUsd && dayUsd >= budget.dailyHardUsd);
const overSessionHard = Boolean(budget.sessionHardTokens && sessionTokens >= budget.sessionHardTokens);

if (overDailyHard || overSessionHard) {
  if (!isSystemDelivery) {
    process.stderr.write(
      overDailyHard
        ? `Budget guard: today's spend is about $${dayUsd.toFixed(2)}, over the hard limit of $${budget.dailyHardUsd}. ${where}`
        : `Budget guard: this session has used ${fmt(sessionTokens)} weighted tokens, over the hard limit. Start a fresh session (/clear), or ask Adam to raise the limit.`,
    );
    process.exit(2);
  }
  notes.push(
    overDailyHard
      ? `today's spend is about $${dayUsd.toFixed(2)}, over the hard limit of $${budget.dailyHardUsd} (${letThrough})`
      : `this session has used ${fmt(sessionTokens)} weighted tokens, over the hard limit (${letThrough})`,
  );
}

if (priced && budget.dailySoftUsd && dayUsd >= budget.dailySoftUsd) {
  notes.push(`today's spend is about $${dayUsd.toFixed(2)} (soft limit $${budget.dailySoftUsd})`);
}
if (budget.sessionSoftTokens && sessionTokens >= budget.sessionSoftTokens) {
  notes.push(`this session has used ${fmt(sessionTokens)} weighted tokens`);
}
if (budget.contextWarnTokens && ctx >= budget.contextWarnTokens) {
  notes.push(`context is at ${fmt(ctx)} tokens, so suggest /compact or /clear before the next big task`);
}
if (notes.length) {
  // stdout from UserPromptSubmit is added to Claude's context.
  process.stdout.write(`[budget-guard] Mention this to Adam briefly at the start of your reply: ${notes.join('; ')}.`);
}
process.exit(0);
