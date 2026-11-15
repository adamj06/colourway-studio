#!/usr/bin/env node
// Stryker exits with "No tests were executed" when its mutate glob matches nothing, which would fail
// the weekly workflow before any colour code exists. Skip cleanly in that case, otherwise run Stryker
// unchanged (its own thresholds.break still fails the run below 80%).
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const target = path.join(root, 'src', 'lib', 'colour');

const hasMutable = (dir) =>
  readdirSync(dir, { withFileTypes: true }).some((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return hasMutable(full);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name);
  });

if (!existsSync(target) || !hasMutable(target)) {
  process.stdout.write('No mutable files in src/lib/colour yet, nothing to mutate. Skipping Stryker.\n');
  process.exit(0);
}

const result = spawnSync('npx', ['--no-install', 'stryker', 'run', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
