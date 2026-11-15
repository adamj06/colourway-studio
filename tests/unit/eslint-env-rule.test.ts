import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Linted as an existing app file (type-aware linting needs a real path); only the restricted-* rules are read.
// The process.env ban must catch every way of reading it, otherwise src/env.ts (zod validation) can be bypassed.
const eslint = new ESLint({ cwd: process.cwd() });

async function messages(code: string, filePath = 'src/config/security-headers.ts') {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId !== null && /restricted/.test(m.ruleId));
}

const evasions: Array<[string, string]> = [
  ['plain member access', 'export const a = process.env.SECRET;'],
  ['bracket access', "export const a = process['env'].SECRET;"],
  ['destructuring', 'const { env } = process;\nexport const a = env.SECRET;'],
  ['renamed destructuring', 'const { env: e } = process;\nexport const a = e.SECRET;'],
  ['named import from node:process', "import { env } from 'node:process';\nexport const a = env.SECRET;"],
  ['named import from process', "import { env } from 'process';\nexport const a = env.SECRET;"],
  ['default import from node:process', "import p from 'node:process';\nexport const a = p.env.SECRET;"],
  ['namespace import from node:process', "import * as p from 'node:process';\nexport const a = p.env.SECRET;"],
  ['globalThis.process.env', 'export const a = globalThis.process.env.SECRET;'],
];

describe('process.env lint rule', { timeout: 60_000 }, () => {
  it.each(evasions)('flags %s in app code', async (_why, code) => {
    expect((await messages(code)).length).toBeGreaterThan(0);
  });

  it('allows src/env.ts to read process.env', async () => {
    expect(await messages('export const a = process.env.NODE_ENV;', 'src/env.ts')).toHaveLength(0);
  });

  it('does not flag unrelated code', async () => {
    expect(await messages("export const a = { env: 'x' }.env;\nexport const b = 'process.env';")).toHaveLength(0);
  });
});
