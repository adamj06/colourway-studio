#!/usr/bin/env node
// PreToolUse guard. Exit code 2 blocks the tool call; stderr is fed back to Claude.
// Belt-and-braces with the deny rules in settings.json: those match patterns,
// this catches the same things inside compound commands, pipes and other tools.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const tool = input.tool_name ?? '';
const ti = input.tool_input ?? {};

function block(reason) {
  process.stderr.write(`BLOCKED by guard hook: ${reason}\nIf this is genuinely needed, stop and ask Adam.\n`);
  process.exit(2);
}

function isSecretPath(p) {
  if (!p || typeof p !== 'string') return false;
  const norm = p.replace(/\\/g, '/');
  const base = path.posix.basename(norm);
  if (/^\.env(\..+)?$/i.test(base) && base.toLowerCase() !== '.env.example') return true;
  if (/\.(pem|key|p12|pfx)$/i.test(base)) return true;
  if (/^id_(rsa|ed25519|ecdsa)/i.test(base)) return true;
  if (/(^|\/)\.vercel\//.test(norm)) return true;
  return false;
}

// File tools
if (['Read', 'Edit', 'MultiEdit', 'Write'].includes(tool)) {
  if (isSecretPath(ti.file_path)) block(`access to secret file "${ti.file_path}"`);
}
if (['Grep', 'Glob'].includes(tool)) {
  const globsForEnv = tool === 'Glob' && /(^|\/)\.env(?!\.example)/i.test(ti.pattern ?? '');
  if (isSecretPath(ti.path) || globsForEnv) block('searching secret files');
}

// Shell
if (tool === 'Bash') {
  const cmd = String(ti.command ?? '');
  const rules = [
    // Path-like .env references only, so `grep process.env src/` still works.
    [/(^|[\s'"=/<>])\.env(?!\.example\b)(\.[\w-]+)?(?=$|[\s'";|&)<>])/i, 'touching .env files from the shell'],
    [/(^|[;&|\s])(printenv|env)(\s*($|[;&|]))/, 'dumping environment variables'],
    [/\brm\s+-[a-z]*r[a-z]*\s+(\/(\s|$)|~|\$HOME|\*|\.\.?(\s|$))/i, 'broad recursive delete'],
    [/\bgit\s+push\b.*(--force\b|--force-with-lease\b|\s-f\b)/, 'force push'],
    [/\bgit\s+push\b.*\b(main|master)\b/, 'pushing to main (use a branch and a PR)'],
    [/\bgit\s+reset\s+--hard\b/, 'git reset --hard'],
    [/--no-verify\b/, 'skipping git hooks'],
    [/\bvercel\b.*--prod\b/, 'production deploy from local (CI deploys main)'],
    [/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh|pwsh|iex)\b/, 'piping a download into a shell'],
    [/\bnpm\s+publish\b/, 'npm publish'],
  ];
  for (const [re, why] of rules) if (re.test(cmd)) block(why);
}

process.exit(0);
