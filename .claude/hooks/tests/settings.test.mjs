import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const settingsPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../settings.json',
);
const deny = JSON.parse(readFileSync(settingsPath, 'utf8')).permissions.deny;

// The guard hook matcher only covers built-in tools, so unused MCP servers are denied.
for (const rule of ['mcp__claude-in-chrome', 'mcp__claude_ai_Claude_Docs']) {
  test(`permissions.deny includes ${rule}`, () => {
    assert.ok(deny.includes(rule), `${rule} missing from permissions.deny`);
  });
}
