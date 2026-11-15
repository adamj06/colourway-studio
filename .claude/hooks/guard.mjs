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
const GATE_FILES = [
  'vitest(?:\\.contract)?\\.config\\.ts',
  'stryker\\.config\\.mjs',
  '\\.size-limit\\.mjs',
  'eslint\\.config\\.mjs',
  'lint-staged\\.config\\.mjs',
  'commitlint\\.config\\.mjs',
  'playwright\\.config\\.ts',
  'tsconfig\\.json',
  'package\\.json',
  '\\.prettierignore',
  `scripts${S}run-mutation\\.mjs`,
  `docs${S}quality-gates\\.md`,
].join('|');
const GUARDRAIL = [
  `\\.claude${S}(?:settings(?:\\.local)?\\.json|budget\\.json|(?:hooks|agents|commands)(?:${S}|${END}))`,
  `(?:^|${S}|[\\s'">])(?:CLAUDE|AGENTS)\\.md${END}`,
  `(?:^|${S}|[\\s'">])(?:${GATE_FILES})${END}`,
  `\\.husky${S}`,
  `\\.github${S}workflows${S}`,
].join('|');
const guardrailRe = new RegExp(GUARDRAIL, 'i');
// The bare .claude directory: deleting, moving or restoring the whole folder removes every guardrail at once.
const bareClaudeRe = /\.claude(?=$|[\s/\\'"])/i;
const touchesGuardrail = (text) => guardrailRe.test(text) || bareClaudeRe.test(text);

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

// A redirect (>, >>, >|) with or without spaces, anywhere in the command, whose target is a guardrail file.
const redirectIntoGuardrail = new RegExp(`\\d*>>?\\|?\\s*["']?[^\\s"'|&;]*(?:${GUARDRAIL})`, 'i');
const inPlaceFlag = /\s(--in-place\b|-[A-Za-z]*i\S*)(?=\s|$)/;
const scriptedWrite =
  /\b(writeFile(Sync)?|appendFile(Sync)?|createWriteStream|copyFile(Sync)?|rename(Sync)?|unlink(Sync)?|rmSync|Set-Content|Add-Content|Out-File|Remove-Item|Copy-Item|Move-Item|New-Item)\b|\bopen\([^)]*,\s*['"][wax+]/i;

const WRITE_VERBS = new Set(['tee', 'mv', 'move', 'rm', 'del', 'unlink', 'rmdir', 'touch', 'truncate']);
const COPY_VERBS = new Set(['cp', 'copy', 'xcopy', 'install', 'ln', 'rsync']);
const GIT_TREE_WRITES = new Set(['checkout', 'restore', 'apply', 'am', 'stash', 'rm', 'mv', 'clean']);
const WRAPPERS = new Set(['sudo', 'command', 'time', 'nice', 'exec', 'nohup']);
// Shell keywords that can sit in front of a command (`then rm x`, `! rm x`).
const LEADERS = new Set(['!', 'if', 'then', 'else', 'elif', 'do', 'while', 'until']);
// Commands that only read. A segment that starts with one is a read, so `grep -n rm .claude/hooks/x` is allowed.
// Redirects are checked separately, over the whole command, so `cat x > .claude/y` is still caught.
const READ_ONLY = new Set(
  'grep egrep fgrep rg cat head tail less more wc ls dir echo stat file diff tree type sort uniq cut nl od'.split(' '),
);

/** One simple command per segment: split on && || ; | & newlines, subshell and group brackets, backticks and $(. */
const segmentsOf = (cmd) => cmd.split(/&&|\|\||\$\(|[;|&\n(){}`]/);

/** Tokens with quotes and a leading backslash stripped, so `"rm"` and `\rm` count as rm. */
const tokensOf = (segment) =>
  segment
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/["']/g, '').replace(/^\\(?=[A-Za-z])/, ''));

const baseName = (token) => path.posix.basename(token.replace(/\\/g, '/')).toLowerCase().replace(/\.exe$/, '');

/** Command position of a segment: skips VAR=x prefixes, shell keywords and wrappers like sudo. */
function commandOf(segment) {
  const tokens = tokensOf(segment);
  let i = 0;
  while (i < tokens.length && (/^[A-Za-z_]\w*=/.test(tokens[i]) || LEADERS.has(tokens[i]) || WRAPPERS.has(tokens[i])))
    i++;
  return { name: baseName(tokens[i] ?? ''), args: tokens.slice(i + 1), tokens };
}

const lastArg = (args) => args.filter((t) => !t.startsWith('-')).pop() ?? '';

/** The directory given by -t DIR, -tDIR, --target-directory DIR or --target-directory=DIR, if any. */
function targetDirectory(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
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
    else if (!args[i]?.startsWith('-')) return args[i] ?? '';
  }
  return '';
}

function gitWritesGuardrail(args, segment) {
  return GIT_TREE_WRITES.has(gitSubcommand(args)) && touchesGuardrail(segment);
}

/** The copy-like command's destination is the -t directory if there is one, otherwise the last argument. */
function copiesIntoGuardrail(names, tokens) {
  const verb = names.findIndex((n) => COPY_VERBS.has(n));
  const args = tokens.slice(verb + 1);
  return touchesGuardrail(targetDirectory(args) || lastArg(args));
}

/** A segment that mentions a guardrail path and is not a known read: does it write to it? Fails closed. */
function commandWritesGuardrail(tokens, segment) {
  const names = tokens.map(baseName);
  if (names.some((n) => WRITE_VERBS.has(n))) return true;
  if (names.some((n) => COPY_VERBS.has(n))) return copiesIntoGuardrail(names, tokens);
  if (names.includes('find') && /\s-delete\b/.test(segment)) return true;
  if (names.includes('sed') || names.includes('perl')) return inPlaceFlag.test(segment);
  if (names.includes('prettier')) return /(--write\b|\s-w\b)/.test(segment);
  if (names.includes('eslint')) return /--fix\b/.test(segment);
  return false;
}

function segmentWritesGuardrail(segment) {
  const { name, args, tokens } = commandOf(segment);
  if (READ_ONLY.has(name)) return false;
  if (name === 'git') return gitWritesGuardrail(args, segment);
  return touchesGuardrail(segment) && commandWritesGuardrail(tokens, segment);
}

function writesGuardrailFile(cmd) {
  // A space is added after every > so a name glued to the redirect (`echo x>CLAUDE.md`) still has a separator.
  if (redirectIntoGuardrail.test(cmd.replace(/>\|?/g, '$& '))) return true;
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

// `git commit -n` (or a cluster like -an) skips the commit hooks. Checked per command, with quoted text blanked,
// so `git commit -m x && git log -n 1` and messages that mention -n are not caught.
const unquoted = (text) => text.replace(/"[^"]*"|'[^']*'/g, '""');
function skipsCommitHooks(cmd) {
  return segmentsOf(unquoted(cmd)).some((segment) => {
    const { name, args } = commandOf(segment);
    return name === 'git' && gitSubcommand(args) === 'commit' && args.some((a) => /^-[A-Za-z]*n[A-Za-z]*$/.test(a));
  });
}

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
    // Git accepts any unique abbreviation of a long option, so --no-veri is the same flag.
    [/--no-ver/, 'skipping git hooks'],
    [/\bHUSKY\s*=\s*["']?0\b/, 'disabling husky'],
    [/\bcore\.hooksPath\b/i, 'redirecting git hooks'],
    [/\bvercel\b.*--prod\b/, 'production deploy from local (CI deploys main)'],
    [/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh|pwsh|iex)\b/, 'piping a download into a shell'],
    [/\bnpm\s+publish\b/, 'npm publish'],
  ];
  for (const [re, why] of rules) if (re.test(cmd)) block(why);
  if (skipsCommitHooks(cmd)) block('skipping git hooks (git commit -n)');
}

process.exit(0);
