# Security review: feat/001-tooling vs main

Scope: `git diff main...HEAD` plus the working tree. The working tree has only the untracked `docs/cost/ledger.csv`, which holds timestamps, session IDs, model names, token counts and USD estimates, with no secrets. I read CLAUDE.md, docs/threat-model.md and docs/runbook.md first. `npm audit --omit=dev` reported 0 vulnerabilities.

I also ran guard.mjs against crafted commands in a harness under /tmp. Allow/BLOCK results are below.

There are no route handlers, no V&A proxy code, no `dangerouslySetInnerHTML` and no `NEXT_PUBLIC_` usage in this branch. The branch is tooling only.

## Critical

None.

## High

**H1. Guard hook has a systemic bypass for relative paths and for `.claude/` paths other than hooks, agents and commands.** The relevant code is `.claude/hooks/guard.mjs:53-55`, the `GUARDRAIL` regex.

- The regex requires the literal text `.claude/(settings.json|settings.local.json|hooks|agents|commands)`. Anything that reaches those files without that substring in one command segment passes.
- Harness results, all ALLOWED:
  - `cd .claude/hooks && sed -i s/a/b/ guard.mjs`
  - `cd .claude/hooks && echo x > guard.mjs`
  - `cd .claude/hooks && cp x guard.mjs`
  - `cd .claude/hooks && rm guard.mjs`
  - `cd .claude && sed -i ... settings.json`
  - `git restore .claude/`
  - `git checkout main -- .claude` (dir with no trailing slash)
  - `echo {} > .claude/budget.json`
  - `sed -i s/a/b/ .claude/budget.json`
  - `cp -t .claude/hooks x` (`-t` puts the destination before the source, but `lastArg` checks only the last argument)
  - `git apply p.patch`
- `cd` splits into its own segment (`&&` is a separator), so the second segment never mentions `.claude`.
- Exploit: the agent can rewrite its own guard or `settings.json` with one `cd` plus a relative path, or revert them with `git restore .claude/`, with no prompt.
- Blocked correctly: `git restore .claude/hooks/guard.mjs`, `sed -i ... .claude/hooks/guard.mjs`, `echo {} > .claude/hooks/pricing.json`, `cp x .claude/hooks/`, `echo x > ./.claude/settings.json`.
- Fix:
  - Track `cd` across segments. Alternatively, treat any command containing `.claude` or a `cd` into it as suspicious and check writes to it.
  - Match the bare `.claude` directory (`\.claude(?=[/\\]|$|[\s'"])`).
  - Resolve the real target for `cp -t`, `mv -t` and `install -t`.
  - Block `git (restore|checkout|apply)` when the command mentions `.claude` anywhere.
  - Better: add a PreToolUse check that compares `git diff --name-only` on guardrail paths, or use CI/CODEOWNERS (see H2).
  - Keep the "best-effort tripwire" wording.

**H2. Edit/Write protection depends on permission mode, and the hook never returns `permissionDecision: "ask"`.** The relevant code is `.claude/settings.json:31-47` (the `ask` rules) and `.claude/hooks/guard.mjs:30-35`.

- For Edit, MultiEdit and Write on guardrail files, the hook does nothing. It only blocks secret paths. Protection rests entirely on the `ask` rules in settings.
- `ask` rules do not prompt in bypass-permissions mode, and `acceptEdits` auto-approves edits under some conditions. docs/threat-model.md:26 admits this for bypass modes.
- Exploit: a session in bypass or auto mode edits `.claude/hooks/guard.mjs` or `settings.json` silently.
- Fix:
  - In guard.mjs, for Edit, MultiEdit and Write whose `file_path` normalises to a guardrail file, emit JSON on stdout: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"..."}}`, then exit 0. A hook `ask` is honoured in more modes than a settings rule.
  - Normalise paths first, since `ti.file_path` may be absolute, use backslashes, or use `..`.
  - Add a CI check, for example CODEOWNERS plus branch protection requiring owner review on `.claude/**`. That is the only real enforcement.

**H3. The guardrail set is incomplete: `.claude/budget.json` and `.claude/hooks/pricing.json` are unprotected.**

- `budget.json` is covered by no ask rule and no regex. The `GUARDRAIL` regex lists only `settings*.json` and the `hooks|agents|commands` directories.
- Exploit: `echo {} > .claude/budget.json` is allowed (harness). Editing `dailyHardUsd` or `sessionHardTokens` removes the spend limits. Zeroing the rates in `pricing.json` (inside `hooks/`, so the Edit/Write ask rule covers it, but the shell redirect is only caught when the full path is written) makes estimated USD zero, so the daily USD cap never triggers.
- Fix: add `.claude/budget.json`, `.claude/hooks/pricing.json`, `.claude/**` generally, and `CLAUDE.md` and `AGENTS.md` to both the ask rules and the guard regex. Make the guardrail pattern `.claude/**`.

## Medium

**M1. Guard false positive on `rm` (reproduced).** `grep -n rm .claude/hooks/guard.mjs` and `grep -rn "rm " .claude/hooks/` are BLOCKED.

- Cause: `guard.mjs:62`, `/\b(tee|mv|move|rm|del|unlink|rmdir|touch|truncate)\b/`, matches the bare word anywhere in a segment that mentions a guardrail path. Searching hooks for "rm", "mv" or "touch" is blocked.
- Impact: this blocks legitimate read-only review. It also pushes users toward disabling the hook.
- Fix: anchor on command position (`(^|[|;&]\s*)(sudo\s+)?rm\b`). Better, parse the first token of each segment.
- Related: guard.mjs also blocked my harness commands. Any command that merely contains the strings it looks for (a heredoc, `git push ... main`, `.env`) is blocked even when it is data.

**M2. Hook-skipping variants not covered.** `guard.mjs:84`, the `--no-verify` rule.

- Harness: `git commit -n -m x` and `git -c core.hooksPath=x commit` are ALLOWED.
- Exploit: this bypasses husky, lint-staged and commitlint.
- Fix: also block `\bcommit\b.*\s-[a-z]*n\b`, `core.hooksPath`, and `HUSKY=0`. Also note `git checkout main` is allowed, which is fine.

**M3. The smoke workflow can leak the Vercel bypass secret to PR-controlled code.** The relevant code is `.github/workflows/smoke.yml:17-35` with `tests/e2e/fixtures.ts:14-26`.

- Smoke runs on `deployment_status` against `github.event.deployment_status.environment_url`, which for previews is the PR's own build.
- The fixture adds `x-vercel-protection-bypass` to every same-origin request. A route handler or middleware in a PR preview can read that header and exfiltrate it. The secret is project-wide, so it also unlocks protected previews and production.
- The checked-out workflow, fixtures and tests come from the PR commit, so a PR author can also print `process.env` directly. The workflow runs with secrets for same-repo branches.
- Exploit: a contributor with branch push access (or a compromised dependency in the PR) captures the bypass secret.
- Fix:
  - Run smoke on preview only for trusted branches. Alternatively, keep a separate smoke job that uses the default-branch `tests/` and workflow.
  - Scope the secret to a GitHub Environment with required reviewers.
  - Treat the Vercel bypass secret as rotatable, and document rotation in the runbook.
  - Validate `BASE_URL` against `*.vercel.app` or the production domain before attaching the header (`fixtures.ts:15` trusts any `baseURL`).
- What is right: the origin-scoped route is correct, trace is off when the secret is set (playwright.config.ts:19), and CI `e2e` does not receive the secret.

**M4. Actions and tools are not pinned to SHAs.** All workflows use `@v4`, `@v3`, `@v2` and `@v1`, including `gitleaks-action@v2` and `anthropics/claude-code-action@v1`.

- Both of those receive `GITHUB_TOKEN` or `CLAUDE_CODE_OAUTH_TOKEN`.
- `ci.yml:~68` runs `pipx run semgrep` unpinned, so it pulls latest on each run.
- SETUP.md:43 instructs "Pin every GitHub Action to a full commit SHA", which contradicts the workflows. docs/threat-model.md:24 states the gap honestly ("pinned to major version tags ... SHA pinning is a known gap"), so it is accurate. docs/production-readiness.md does not mention the gap.
- Fix: pin to SHAs with a version comment (Dependabot updates them), and pin the `semgrep` version.

**M5. docs/threat-model.md:23 and docs/runbook.md:39 present the contract check as active, but it is vacuous.**

- `tests/contract/` does not exist and `vitest.contract.config.ts:10` sets `passWithNoTests: true`. `npm run test:contract` therefore passes with zero tests.
- `.github/workflows/contract.yml` runs daily and is green but validates nothing. The "daily contract check opens an issue on schema drift" claim is unproven.
- `docs/production-readiness.md:7` also claims "a daily contract check against the real API".
- Also, the issue step (`contract.yml:~38`) uses `--label contract-drift ... || true`. If the label does not exist, `gh issue create` fails and is swallowed, so no issue is ever opened. The job still fails, but nobody is notified beyond the failed run.
- Fix:
  - Mark it "planned, no tests yet" in the docs, or add a placeholder test that fails if the suite is empty.
  - Create the label, or run `gh label create` first.
  - Drop `|| true`, or use `gh issue create ... || gh issue create` without the label.

**M6. Dependency version mismatch will break the size gate.** `package.json` pins `@size-limit/file ^13.1.1` and `size-limit ^12.1.0`.

- `@size-limit/file@13.1.1` has peer `size-limit@13.1.1`. `npm ls` reports `invalid` and exits with ELSPROBLEMS.
- `npx size-limit` in CI may fail or behave unpredictably, and `npm ci` can complain about peers.
- Fix: bump `size-limit` to ^13.

## Low

**L1. Process env lint rule gaps.** The relevant code is `eslint.config.mjs`, the `no-restricted-properties` rule (object `process`, property `env`).

- It catches `process.env.X` only. It does not catch `const { env } = process`, `import { env } from 'node:process'`, `import process from 'node:process'` (the import form is also caught as `process.env` if the identifier is `process`, but a renamed import is not), or `globalThis.process.env`.
- Fix: add `no-restricted-imports` for `node:process` and `process`, and `no-restricted-syntax` for `VariableDeclarator[init.name='process'][id.type='ObjectPattern']` and `MemberExpression[object.name='globalThis'][property.name='process']`.
- The exemption list (`eslint.config.mjs`, "Files that legitimately read process.env") is broad: `*.config.{ts,mjs,js,cjs}`, `tests/e2e/**` and `tests/contract/**` may read any env var. `.claude/hooks/**` is also exempt. Acceptable, but a `NEXT_PUBLIC_` audit rule would help.

**L2. `src/env.ts`: `NODE_ENV` defaults to `'development'` when unset.** That fails open to adding `'unsafe-eval'` to `script-src` (`security-headers.ts:12-15`) in any context where NODE_ENV is missing. `next build` and `next start` set it, so risk is low. Prefer defaulting to `'production'` for the header logic.

**L3. HSTS and `VERCEL_ENV` are evaluated at build time.** `next.config.ts:18` evaluates `headers()` using `env.VERCEL_ENV`, which Vercel sets at build.

- A preview build promoted to production would lack HSTS and `upgrade-insecure-requests`. The runbook's rollback only promotes previous production deployments, which is fine. Also note it in the runbook.
- HSTS is `max-age=63072000; includeSubDomains` without `preload`. If a custom apex domain is added, `includeSubDomains` for 2 years affects every subdomain. Document this, or drop `includeSubDomains` until the domain is fixed.

**L4. CSP omissions (informational about intent).**

- `connect-src 'self'` will block a direct `fetch()` of framemark images if the CORS spike chooses fetch for canvas pixel reads. Add framemark there if needed, and keep threat-model.md in sync.
- There is no `worker-src`. Workers fall back to `child-src`, then `script-src 'self'`. Bundled Web Workers (`new Worker(new URL(...))`) work. A blob: worker would be blocked, which is the safer default.
- No `media-src`, `manifest-src` or `frame-src`, but `default-src 'self'` covers them.
- `COOP: same-origin` is fine. There is no COEP, so there is no cross-origin isolation or SharedArrayBuffer.
- `img-src` (security-headers.ts:7) includes `blob: data:` as well as self and framemark. The security-reviewer spec says "self and framemark only"; blob: and data: are needed for canvas export but should be documented.
- `style-src 'unsafe-inline'` and `script-src 'unsafe-inline'` are documented in ADR 0003 and accurately described in the threat model.

**L5. `smoke.yml` and `playwright.config.ts` edge case.** `remoteBaseUrl ? {} : webServer`: an empty `BASE_URL` string takes the local-server path while `baseURL` is `''`. If `environment_url` is empty (some Vercel deployment events), smoke would not test the deployment. Prefer `process.env.BASE_URL || undefined` and fail loudly in CI.

**L6. Workflow permissions are mostly least-privilege (`contents: read`).** `claude-review.yml` grants `pull-requests: write` on `pull_request` (not `pull_request_target`), which is fine, and fork PRs get no secrets. It reviews untrusted PR content, so prompt injection could produce misleading review comments. The risk is limited because the token cannot push (`contents: read`).

- `contract.yml` interpolates only `github.server_url`, `github.repository` and `github.run_id` in `run:`, so there is no injection risk.
- `ci.yml` uploads `playwright-report/` as an artifact on every run. That is safe today because the secret is not in the CI env, but add a comment or guard so it never runs with the bypass secret.
- No `pull_request_target` is used anywhere.

## Info

- **Bypass secret handling:** `playwright.config.ts:19` and `tests/e2e/fixtures.ts` are correct as the threat model describes. The secret is sent only to the base origin and tracing is off when it is set. Residual risk is M3.
- **Dependencies:** the only runtime dependencies are `next 16.4.6`, `react 19.3.0`, `react-dom` and `zod`, all current. `@tailwindcss/turbopack` is pinned. No unmaintained or unnecessary runtime packages. The lockfile diff is large but consistent with the tooling additions.
- **`.gitignore`:** `.env*` is ignored with `!.env.example`. `.vercel` is ignored. `*.pem` is ignored, but `*.key` is not (the guard hook blocks reading keys though). `docs/cost/ledger.csv` is not ignored and is currently untracked. It is not sensitive.
- **Threat model accuracy:**
  - The SHA-pinning statement is honest (see M4).
  - The statement that ask rules are not enforced in bypass modes is accurate, but H2 shows the hook could close that gap.
  - The headers section matches `src/config/security-headers.ts`: HSTS only in production, `unsafe-eval` only in dev, and `img-src` with framemark.
  - The SSRF row describes mitigations that are not implemented yet (no proxy code in this branch). This is fine as a design target but is unverified here.
- **Categories checked with nothing found in this branch** (because no code exists yet): SSRF in the V&A proxy, input validation of query params and colourway state, XSS from V&A HTML, proxy caching and fan-out, `NEXT_PUBLIC_` secrets in client bundles. Re-run this review once the `/api/vam/*` routes land.
