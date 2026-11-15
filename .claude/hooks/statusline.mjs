#!/usr/bin/env node
// Status line: model | session cost | context used | branch. Always visible, so cost is never a surprise.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { transcriptUsage, contextTokens } from './lib-usage.mjs';

const s = JSON.parse(readFileSync(0, 'utf8') || '{}');
const model = s.model?.display_name ?? 'model?';
const cost = s.cost?.total_cost_usd;
const { last } = transcriptUsage(s.transcript_path);
const ctx = contextTokens(last?.u);
const ctxK = `${Math.round(ctx / 1000)}k ctx`;
const cwd = s.workspace?.current_dir ?? process.cwd();
const branch = spawnSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' }).stdout?.trim();

const warn = ctx > 120000 ? ' ⚠ compact' : '';
const parts = [model, cost != null ? `$${cost.toFixed(2)}` : null, ctxK + warn, branch ? `⎇ ${branch}` : null];
process.stdout.write(parts.filter(Boolean).join('  |  '));
