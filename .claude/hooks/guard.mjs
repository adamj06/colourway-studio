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

// Guardrail files: the agent may not change its own guardrails from the shell without Adam's approval.
// Edit/Write/MultiEdit on these paths are covered by "ask" rules in settings.json instead. This is a
// best-effort tripwire for obvious shell writes, not a sandbox: it can't see through arbitrary scripts.
const GUARDRAIL =
  '\\.claude[/\\\\](?:settings(?:\\.local)?\\.json|(?:hooks|agents|commands)(?:[/\\\\]|(?=$|[\\s\'"])))';
const guardrailRe = new RegExp(GUARDRAIL, 'i');
const redirectIntoGuardrail = new RegExp(`(?:^|[^\\w>])\\d*>>?\\s*["']?[^\\s"'|&;]*${GUARDRAIL}`, 'i');
const inPlaceFlag = /\s(--in-place\b|-[A-Za-z]*i\S*)(?=\s|$)/;
const scriptedWrite =
  /\b(writeFile(Sync)?|appendFile(Sync)?|createWriteStream|copyFile(Sync)?|rename(Sync)?|unlink(Sync)?|rmSync|Set-Content|Add-Content|Out-File|Remove-Item|Copy-Item|Move-Item|New-Item)\b|\bopen\([^)]*,\s*['"][wax+]/i;

const lastArg = (segment) =>
  segment
    .trim()
    .split(/\s+/)
    .filter((t) => !t.startsWith('-'))
    .pop() ?? '';

// Each rule gets one command segment that already mentions a guardrail path.
const segmentWriteRules = [
  (s) => redirectIntoGuardrail.test(s),
  (s) => /\b(tee|mv|move|rm|del|unlink|rmdir|touch|truncate)\b/.test(s),
  (s) => /\b(sed|perl)\b/.test(s) && inPlaceFlag.test(s),
  (s) => /\b(cp|copy|xcopy|install|ln|rsync)\b/.test(s) && guardrailRe.test(lastArg(s)),
  (s) => /\bprettier\b/.test(s) && /(--write\b|\s-w\b)/.test(s),
  (s) => /\beslint\b/.test(s) && /--fix\b/.test(s),
  (s) => /\bgit\s+(checkout|restore|apply|am|stash|rm|mv|clean)\b/.test(s),
];

function writesGuardrailFile(cmd) {
  if (!guardrailRe.test(cmd)) return false;
  if (scriptedWrite.test(cmd)) return true;
  return cmd
    .split(/&&|\|\||[;|\n]/)
    .filter((segment) => guardrailRe.test(segment) || redirectIntoGuardrail.test(segment))
    .some((segment) => segmentWriteRules.some((rule) => rule(segment)));
}

// Shell
if (tool === 'Bash') {
  const cmd = String(ti.command ?? '');
  if (writesGuardrailFile(cmd)) {
    block("writing to guardrail files (.claude/settings.json, hooks, agents, commands) needs Adam's approval");
  }
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
