#!/usr/bin/env node
// PreToolUse guard. Exit code 2 blocks the tool call; stderr is fed back to Claude.
// Belt-and-braces with the deny rules in settings.json: those match patterns,
// this catches the same things inside compound commands, pipes and other tools.
//
// THE REGEX GUARD IS A TRIPWIRE, NOT A SANDBOX. The real controls are this hook's "ask" decision on
// Edit/Write/MultiEdit of guardrail files, branch protection and review. Known gaps are listed in docs/threat-model.md.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const tool = input.tool_name ?? '';
const ti = input.tool_input ?? {};

function block(reason) {
  process.stderr.write(`BLOCKED by guard hook: ${reason}\nIf this is genuinely needed, stop and ask Adam.\n`);
  process.exit(2);
}

/** Ask Adam, whatever the permission mode (a hook "ask" is honoured where settings "ask" rules may not be). */
function ask(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason },
    }),
  );
  process.exit(0);
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

// Guardrail files: the agent may not change its own guardrails or quality gates without Adam's approval.
const S = '[/\\\\]';
const END = '(?=$|[\\s\'"])';
const GUARDRAIL = [
  `\\.claude${S}(?:settings(?:\\.local)?\\.json|budget\\.json|(?:hooks|agents|commands)(?:${S}|${END}))`,
  `(?:^|${S}|[\\s'"])(?:CLAUDE|AGENTS)\\.md${END}`,
  `(?:^|${S}|[\\s'"])(?:vitest(?:\\.contract)?\\.config\\.ts|stryker\\.config\\.mjs|\\.size-limit\\.mjs|eslint\\.config\\.mjs|lint-staged\\.config\\.mjs|commitlint\\.config\\.mjs)${END}`,
  `\\.husky${S}`,
  `\\.github${S}workflows${S}`,
].join('|');
const guardrailRe = new RegExp(GUARDRAIL, 'i');
// The bare .claude directory, which only matters for git commands that rewrite a whole tree.
const bareClaudeRe = /\.claude(?=$|[\s/\\'"])/i;

// File tools
if (['Read', 'Edit', 'MultiEdit', 'Write'].includes(tool)) {
  if (isSecretPath(ti.file_path)) block(`access to secret file "${ti.file_path}"`);
}
if (['Grep', 'Glob'].includes(tool)) {
  const globsForEnv = tool === 'Glob' && /(^|\/)\.env(?!\.example)/i.test(ti.pattern ?? '');
  if (isSecretPath(ti.path) || globsForEnv) block('searching secret files');
}

// Edit/Write/MultiEdit on guardrail files: ask Adam ourselves, in every permission mode.
if (['Edit', 'MultiEdit', 'Write'].includes(tool) && typeof ti.file_path === 'string') {
  const root = (process.env.CLAUDE_PROJECT_DIR || process.cwd()).replace(/\\/g, '/').replace(/\/$/, '');
  let p = path.posix.normalize(ti.file_path.replace(/\\/g, '/'));
  if (p.toLowerCase().startsWith(`${root.toLowerCase()}/`)) p = p.slice(root.length + 1);
  if (guardrailRe.test(p))
    ask(`"${ti.file_path}" is a guardrail or quality-gate file: Adam must approve changes to it.`);
}

const redirectIntoGuardrail = new RegExp(`(?:^|[^\\w>])\\d*>>?\\s*["']?[^\\s"'|&;]*(?:${GUARDRAIL})`, 'i');
const inPlaceFlag = /\s(--in-place\b|-[A-Za-z]*i\S*)(?=\s|$)/;
const scriptedWrite =
  /\b(writeFile(Sync)?|appendFile(Sync)?|createWriteStream|copyFile(Sync)?|rename(Sync)?|unlink(Sync)?|rmSync|Set-Content|Add-Content|Out-File|Remove-Item|Copy-Item|Move-Item|New-Item)\b|\bopen\([^)]*,\s*['"][wax+]/i;

const WRITE_VERBS = new Set(['tee', 'mv', 'move', 'rm', 'del', 'unlink', 'rmdir', 'touch', 'truncate']);
const COPY_VERBS = new Set(['cp', 'copy', 'xcopy', 'install', 'ln', 'rsync']);
const GIT_TREE_WRITES = new Set(['checkout', 'restore', 'apply', 'am', 'stash', 'rm', 'mv', 'clean']);
const WRAPPERS = new Set(['sudo', 'command', 'time', 'nice', 'exec', 'nohup']);

/** Command position of a segment: skips VAR=x prefixes and wrappers like sudo. Returns { name, args }. */
function commandOf(segment) {
  const tokens = segment.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length && (/^[A-Za-z_]\w*=/.test(tokens[i]) || WRAPPERS.has(tokens[i]))) i++;
  const name = path.posix
    .basename((tokens[i] ?? '').replace(/\\/g, '/'))
    .toLowerCase()
    .replace(/\.exe$/, '');
  return { name, args: tokens.slice(i + 1) };
}

const lastArg = (args) => args.filter((t) => !t.startsWith('-')).pop() ?? '';

/** The directory given by -t DIR, -tDIR, --target-directory DIR or --target-directory=DIR, if any. */
function targetDirectory(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-t' || a === '--target-directory') return args[i + 1] ?? '';
    if (a.startsWith('--target-directory=')) return a.slice('--target-directory='.length);
    if (/^-t.+/.test(a) && !a.startsWith('--')) return a.slice(2);
  }
  return '';
}

/** First git subcommand, skipping global options (-c key=value and -C dir take a value). */
function gitSubcommand(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-c' || args[i] === '-C') i++;
    else if (!args[i].startsWith('-')) return args[i];
  }
  return '';
}

// Each segment is one simple command (split on && || ; | and newlines). Verbs only count at command position,
// so `grep -n rm .claude/hooks/guard.mjs` is a read, not a write.
function gitWritesGuardrail(args, segment) {
  const rewritesTree = GIT_TREE_WRITES.has(gitSubcommand(args));
  return rewritesTree && (guardrailRe.test(segment) || bareClaudeRe.test(segment));
}

/** A segment that already mentions a guardrail path: does its command write to it? */
function commandWritesGuardrail(name, args, segment) {
  if (WRITE_VERBS.has(name)) return true;
  if (COPY_VERBS.has(name)) {
    // With -t DIR the destination is DIR and the last argument is a source; otherwise it is the last argument.
    const target = targetDirectory(args);
    return guardrailRe.test(target || lastArg(args));
  }
  if (name === 'sed' || name === 'perl') return inPlaceFlag.test(segment);
  if (/\bprettier\b/.test(segment)) return /(--write\b|\s-w\b)/.test(segment);
  if (/\beslint\b/.test(segment)) return /--fix\b/.test(segment);
  return false;
}

function segmentWritesGuardrail(segment) {
  if (redirectIntoGuardrail.test(segment)) return true;
  const { name, args } = commandOf(segment);
  if (name === 'git') return gitWritesGuardrail(args, segment);
  return guardrailRe.test(segment) && commandWritesGuardrail(name, args, segment);
}

const segmentsOf = (cmd) => cmd.split(/&&|\|\||[;|\n]/);

function writesGuardrailFile(cmd) {
  if (guardrailRe.test(cmd) && scriptedWrite.test(cmd)) return true;
  return segmentsOf(cmd).some(segmentWritesGuardrail);
}

/** Dumping the environment: `env` or `printenv` with nothing after them, as a command (not text like `a = env;`). */
function dumpsEnvironment(cmd) {
  return segmentsOf(cmd).some((s) => {
    const { name, args } = commandOf(s);
    return (name === 'printenv' || name === 'env') && args.length === 0;
  });
}

// Skipping the commit hooks without --no-verify. Quoted text is blanked first so a message can mention "-n".
const unquoted = (line) => line.replace(/"[^"]*"|'[^']*'/g, '""');
const commitNoVerifyShort = (cmd) =>
  cmd.split('\n').some((line) => /\bgit\b.*\bcommit\b.*\s-[A-Za-z]*n[A-Za-z]*(?=\s|$)/.test(unquoted(line)));

// Shell
if (tool === 'Bash') {
  const cmd = String(ti.command ?? '');
  if (writesGuardrailFile(cmd)) {
    block(
      "writing to guardrail files (.claude settings, budget, hooks, agents, commands; CLAUDE.md, AGENTS.md; quality-gate configs; .husky; workflows) needs Adam's approval",
    );
  }
  if (dumpsEnvironment(cmd)) block('dumping environment variables');
  const rules = [
    // Path-like .env references only, so `grep process.env src/` still works.
    [/(^|[\s'"=/<>])\.env(?!\.example\b)(\.[\w-]+)?(?=$|[\s'";|&)<>])/i, 'touching .env files from the shell'],
    [/\brm\s+-[a-z]*r[a-z]*\s+(\/(\s|$)|~|\$HOME|\*|\.\.?(\s|$))/i, 'broad recursive delete'],
    [/\bgit\s+push\b.*(--force\b|--force-with-lease\b|\s-f\b)/, 'force push'],
    [/\bgit\s+push\b.*\b(main|master)\b/, 'pushing to main (use a branch and a PR)'],
    [/\bgit\s+reset\s+--hard\b/, 'git reset --hard'],
    [/--no-verify\b/, 'skipping git hooks'],
    [/\bHUSKY\s*=\s*0\b/, 'disabling husky'],
    [/\bcore\.hooksPath\b/i, 'redirecting git hooks'],
    [/\bvercel\b.*--prod\b/, 'production deploy from local (CI deploys main)'],
    [/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh|pwsh|iex)\b/, 'piping a download into a shell'],
    [/\bnpm\s+publish\b/, 'npm publish'],
  ];
  for (const [re, why] of rules) if (re.test(cmd)) block(why);
  if (commitNoVerifyShort(cmd)) block('skipping git hooks (git commit -n)');
}

process.exit(0);
