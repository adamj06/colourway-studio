#!/usr/bin/env node
// PostToolUse: format and lint the file Claude just edited.
// Exit 2 with lint errors so Claude sees them and fixes them straight away.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const file = input.tool_input?.file_path;
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();

if (!file || !existsSync(file)) process.exit(0);
if (/node_modules|\.next|[\\/]dist[\\/]/.test(file)) process.exit(0);
if (!existsSync(path.join(root, 'node_modules'))) process.exit(0); // not scaffolded yet

const run = (args) =>
  spawnSync('npx', ['--no-install', ...args], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });

if (/\.(ts|tsx|js|jsx|mjs|cjs|css|json|md)$/i.test(file)) {
  run(['prettier', '--write', '--log-level', 'warn', file]);
}

if (/\.(ts|tsx|js|jsx|mjs)$/i.test(file)) {
  const r = run(['eslint', '--fix', '--max-warnings', '0', file]);
  if (r.status && r.status !== 0) {
    process.stderr.write(`ESLint problems in ${file}:\n${(r.stdout + r.stderr).slice(-3000)}`);
    process.exit(2);
  }
}

process.exit(0);
