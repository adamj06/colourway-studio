#!/usr/bin/env node
// Stop hook: before Claude finishes a turn, if code changed, typecheck and run related tests.
// Exit 2 sends the failure back to Claude so it keeps working instead of claiming "done".
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
if (input.stop_hook_active) process.exit(0); // avoid infinite loops

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
if (!existsSync(path.join(root, 'node_modules'))) process.exit(0);

const sh = (cmd, args) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });

const status = sh('git', ['status', '--porcelain']).stdout ?? '';
const codeChanged = status.split('\n').some((l) => /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(l.trim()));
if (!codeChanged) process.exit(0);

const failures = [];
const tc = sh('npm', ['run', 'typecheck', '--silent']);
if (tc.status !== 0) failures.push(`TYPECHECK FAILED:\n${(tc.stdout + tc.stderr).slice(-2500)}`);

const t = sh('npx', ['--no-install', 'vitest', 'run', '--changed', '--passWithNoTests']);
if (t.status !== 0) failures.push(`TESTS FAILED:\n${(t.stdout + t.stderr).slice(-2500)}`);

if (failures.length) {
  process.stderr.write(
    `${failures.join('\n\n')}\n\nFix these before finishing. Do not weaken tests to make them pass.`,
  );
  process.exit(2);
}
process.exit(0);
