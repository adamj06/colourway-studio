# Security re-review: a6cc001..HEAD (feat/001-tooling)

Scope: 9 commits, 38 files. I read CLAUDE.md, the threat model, the runbook and the Phase A security report first.

Checks run:

- `node --test ".claude/hooks/tests/*.test.mjs"` gives 134 of 134 passing.
- `npm audit --omit=dev` found 0 vulnerabilities.
- `npm ls size-limit` is clean. Both packages resolve to 13.1.1.
- I confirmed the two action SHAs against upstream with `git ls-remote`. `gitleaks-action@ff98106e…` is v2.3.9. `claude-code-action@f3b070c8…` is the peeled commit of the annotated tag v1.0.276. Both pins are correct.
- I drove `guard.mjs` directly with about 250 crafted Edit, Write and Bash inputs, using a harness in the scratchpad.

Two harness notes:

- The guard blocked my own heredocs several times. The causes were `rm` matched case-insensitively, `commit -n` matched inside text, and guardrail names next to `>`. This is the known "fires on text that merely mentions a path" false positive. I worked around it with placeholder substitution in the harness. I did not modify any project file.
- All guard findings below are tripwire strength. They are not exploitable without the agent being adversarial or prompt-injected.

## Phase A findings

| Phase A finding                                        | Status                   | Notes                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1 shell bypasses of the guardrail path regex          | **Partly fixed**         | Fixed: `cp -t`/`mv -t`/`install -t`, `budget.json`, `git restore/checkout/stash/clean` on the bare `.claude`, and false positives. `cd`, `dd` and `git apply` are documented as known gaps. New bypasses are listed as N1 to N4.                                                                                        |
| H2 Edit/Write depend on permission mode, no hook `ask` | **Fixed**                | `guard.mjs:55-62` returns `permissionDecision: "ask"`. Normalisation is correct for absolute paths, backslashes, `..`, `//`, `./`, mixed case, a different drive-letter case and `/d/...` MSYS paths. Whether `ask` is honoured in bypassPermissions mode is a Claude Code behaviour I could not verify here. See Info. |
| H3 `budget.json` and `pricing.json` unprotected        | **Fixed for Edit/Write** | `budget.json` is in the regex, the ask rules and the hook. `pricing.json` is covered through `hooks/`. `docs/cost/ledger.csv` stays unprotected and is documented.                                                                                                                                                      |
| M1 `rm` false positive                                 | **Fixed**                | Verbs now count only at command position. `grep -n rm .claude/hooks/guard.mjs` is allowed.                                                                                                                                                                                                                              |
| M2 hook-skipping variants                              | **Partly fixed**         | Now blocked: `commit -n`, `-anm`, `core.hooksPath`, `HUSKY=0`. Still allowed: N5.                                                                                                                                                                                                                                       |
| M3 smoke can leak the bypass secret                    | **Partly fixed**         | The secret is sent once, Node-side, with `maxRedirects: 0`, to a validated origin. The page never carries it, and a test asserts that. The residual risk is documented. See N6 and N7.                                                                                                                                  |
| M4 actions not pinned                                  | **Partly fixed**         | Only the two token-bearing actions are pinned. `semgrep` is still unpinned. The threat model states this honestly. See N8.                                                                                                                                                                                              |
| M5 contract check presented as active                  | **Fixed**                | The docs now say "planned". `gh label create` was added and `\|\| true` removed. The job still passes vacuously, which is documented.                                                                                                                                                                                   |
| M6 size-limit mismatch                                 | **Fixed**                |                                                                                                                                                                                                                                                                                                                         |
| L1 env lint gaps                                       | **Mostly fixed**         | `node:process` imports, `globalThis.process.env` and `const { env } = process` are banned, and a unit test covers them. Not covered: `const p = process; p.env`, `process['env']` and `require('node:process')`.                                                                                                        |
| L2 NODE_ENV defaults to development                    | **Fixed**                | `src/env.ts:5` now defaults to `production`.                                                                                                                                                                                                                                                                            |
| L3 build-time HSTS and rollback                        | **Fixed (documented)**   | Runbook and threat model both say to promote only previous production deployments.                                                                                                                                                                                                                                      |
| L4 `worker-src`                                        | **Fixed**                | `security-headers.ts:22` sets `worker-src 'self'`, and there is a test.                                                                                                                                                                                                                                                 |
| L5 empty `BASE_URL`                                    | **Fixed**                | `playwright.config.ts:5` uses `\|\| undefined`, and `smoke.yml` fails loudly.                                                                                                                                                                                                                                           |
| L6 artifact upload                                     | **Fixed**                | The comment in `ci.yml` is accurate. `smoke.yml` uploads nothing.                                                                                                                                                                                                                                                       |

## Critical

None.

## High

None.

## Medium

**N1. Redirect with no space before `>` bypasses the guard.** `.claude/hooks/guard.mjs:~97`, the `redirectIntoGuardrail` regex.

- The regex requires a non-word character before `>`.
- Evidence: `echo x>.claude/budget.json` is allowed, and so are `echo x>CLAUDE.md` and `echo x>eslint.config.mjs`. `echo x > ...` and `echo {}>...` are blocked.
- This is the most natural way to write a redirect, and it is neither documented nor pinned as a known gap. The threat model line "redirects into those files" is therefore overstated.
- Fix: drop the `[^\w>]` prefix. Match `\d*>>?\|?` anywhere, or tokenise redirects.

**N2. Deleting or moving the whole `.claude` directory is not caught.**

- `rm -rf .claude` and `mv .claude x` are allowed. `bareClaudeRe` is applied only to git subcommands.
- `find .claude -delete` is also allowed.
- Deleting the folder removes the hooks and settings in one command.
- Fix: apply `bareClaudeRe` to WRITE_VERBS and `find -delete` as well.

**N3. Write tools missing from the shell guard.**

- With a guardrail path named, these are all allowed: `awk -i inplace`, `ed`, `vim -c wq`, `ex`, `echo x >| file` (clobber redirect), and `dd of=` (the dd case is documented).
- Variable indirection, for example `f=.claude/hooks/guard.mjs; rm $f`, is also allowed. This one is under the generic "variables" gap.
- Globs and quote-splitting that defeat the literal match are allowed too: `> .claude/bud*.json`, `> .cla*/budget.json`, `.claude/bud""get.json`.
- The threat model's known-gaps list names `dd` and "any other write tool", so it is honest in principle. It does not mention `>|`, the no-space redirect, the bare directory or globs.
- Fix: list N1 to N3 in the known gaps, or close them. Closing them beyond a tripwire is unrealistic. Branch protection, review and CODEOWNERS are the real control.

**N4. The guardrail file set is incomplete for Edit/Write ask.** `guard.mjs:30-36`, with the settings ask rules. Edits to these files raise no prompt:

- `.github/CODEOWNERS` and `.github/dependabot.yml`
- `package.json` (scripts, lifecycle hooks, dependencies)
- `next.config.ts`, `src/config/security-headers.ts`, `src/env.ts` (the CSP and header source)
- `playwright.config.ts`, `scripts/run-mutation.mjs`
- `.gitignore` and `.prettierignore`
- `.claude/launch.json` and any other file directly under `.claude/`
- `docs/quality-gates.md` (the gate contract)
- `docs/threat-model.md`
- `docs/cost/ledger.csv` (documented)
- Exploit: the agent weakens the CSP or adds a malicious `postinstall` without a prompt.
- Fix: make the pattern `.claude/**` and add `package.json`, `next.config.ts`, `src/config/security-headers.ts`, `playwright.config.ts`, `.github/**`, `docs/quality-gates.md` and `docs/threat-model.md`. Add a CODEOWNERS file covering the guardrail paths and require owner review in branch protection. That is the only real enforcement.
- Over-match to note: `docs/CLAUDE.md` or any `*/CLAUDE.md` triggers ask. This is harmless.

**N5. Hook-skip and force-push variants still allowed.** `guard.mjs`, the rules list.

- `git push -fu origin x` is allowed. The force-push regex needs `-f` as a standalone token.
- `git push origin +HEAD` and `git push --mirror` are allowed.
- `HUSKY="0" git commit` is allowed. Only the unquoted form is matched.
- `git -C . reset --hard` is allowed. The regex requires `git reset` adjacent.
- `vercel deploy --target=production` and `vercel --target production` are allowed.
- `pnpm publish`, `git clean -fdx` and `git checkout -- .` are allowed. These are destructive but not listed in CLAUDE.md.
- `curl url | env bash`, `| node` and `| python3` are allowed. So is `bash <(curl ...)`, `sh -c "$(curl ...)"`, and the unquoted `GIT_CONFIG_*` env route to `core.hooksPath`.
- Mitigation: `git push` is an ask rule in settings, and `gh pr merge` and the other `gh` commands are allowed. The `--target production` gap is the most relevant for CLAUDE.md's "never deploy to production from local" rule.
- Fix: match `\bgit\b.*\bpush\b.*\s-[a-z]*f`, `\+\S`, `--mirror`, `--target[= ]production`, `HUSKY\s*=\s*["']?0`, and `\bgit\b.*\breset\b.*--hard`. Add `pnpm|yarn publish`.

**N6. The bypass-secret trust rule is broader than the project.** `tests/e2e/trusted-origin.ts:17`.

- `host.endsWith('.vercel.app')` trusts any Vercel tenant, because anyone can register `evil.vercel.app`.
- Exploit: a forged or misrouted `environment_url`, or a PR that changes `BASE_URL`, sends the project-wide secret to an attacker-owned `*.vercel.app` host. On a same-repo branch the PR author controls the workflow anyway (see N7).
- What is right:
  - `new URL` normalises case and IDN to punycode.
  - A trailing dot (`x.vercel.app.`) fails `endsWith`.
  - Userinfo, a non-https scheme and a lookalike such as `vercel.app.evil.com` are all rejected. The lookalike `evilvercel.app` is rejected because the match requires the dot.
  - The cookie flow is correct: `context.request` shares cookies with the page context, redirects are off, and the secret is never in an error message.
  - The unit tests in `trusted-origin.test.ts` cover these cases.
- Fix: allow only this project's exact hostnames, for example `colourway-studio-*-<team>.vercel.app` or `BYPASS_ALLOWED_HOSTS`. The default in `smoke.yml` is empty, so make the Vercel pattern opt-in too.

## Low

**N7. Residual smoke-secret exposure.** `smoke.yml:~23-38`.

- The workflow checks out the PR commit, which is the deployment SHA, and passes the secret as env. A same-repo branch PR can edit the test or workflow and print it.
- This is acknowledged in the threat model as accepted for a solo project. The fix is a GitHub Environment with required reviewers, or running smoke from default-branch code.
- Related: `deployment_status` workflows run from the default branch's workflow file, but the checkout is the deployment SHA. So the PR can change the tests that run, though not the workflow file. The threat model wording "runs the PR's own tests and preview build" is accurate.

**N8. Supply chain.**

- `ci.yml:76` runs `pipx run semgrep` unpinned.
- `actions/checkout`, `setup-node`, `upload-artifact` and `github/codeql-action` are on tags only. Of these, only `upload-artifact` and `codeql-action` handle data, and neither receives a long-lived secret. `gitleaks-action` and `claude-code-action` are pinned. The threat model states all of this accurately.
- Fix: pin `semgrep==<ver>`.

**N9. Budget guard can under-count.** `.claude/hooks/budget.mjs` and `lib-usage.mjs`.

- The 0.1 cache-read weighting is accurate to the price table (cacheRead is 0.2 against input 4 to 8, which is 0.025 to 0.05, so the weight is conservative). Output tokens are weighted 1x against a price roughly 5x input, so the token cap says little about dollars.
- A model name that matches no key in `pricing.json` makes `priced` false. `budget.mjs:15-18` then skips both the daily and the session USD checks silently. A new model name therefore disables the USD hard limit. Only the 10M token cap remains.
- The ledger is written only on SessionEnd. A crashed or killed session is not counted toward the day total.
- 1-hour cache writes (billed at 2x) are priced as 5-minute writes.
- Fix: treat an unknown model as the most expensive tier, or warn once. Weight output at about 5x.

**N10. Minor.**

- eslint: `no-restricted-properties` is off for `tests/e2e/**`, `*.config.*` and `.claude/hooks/**`. That is intentional. The new `no-restricted-syntax` and `no-restricted-imports` rules still apply to those files, which is fine. A `NEXT_PUBLIC_` audit rule is still absent.
- The threat model says the guard blocks "`cp`, `mv` and `install` into them". Accurate. It also says "`git restore/checkout/stash/clean/rm/mv` on them or on the bare `.claude` folder". That is accurate for git only (N2).
- `stop-checks.mjs` `codeChanged` now includes cjs, mts and cts. Fine.
- `docs/friction-log.md` has an uncommitted modification in the working tree, which is not a security matter.

## Accuracy of the new docs against the code

- The CSP, `worker-src`, the NODE_ENV default, HSTS at build time, the smoke-secret flow, the contract "planned" wording and the runbook rotation text all match the code.
- Inaccurate or overstated:
  - "Redirects into those files" in the threat model (N1).
  - The known-gaps list omits N1 to N3 and the `.claude` directory delete.
  - The mutation and size claims were not re-verified.
- Honest and complete enough: `cd`, `dd`, `git apply`, scripts and variables, outside-Bash tools, and the ledger.

## Checked, nothing found

- No new route handlers, `NEXT_PUBLIC_` usage, SSRF surface or XSS surface in this range. The proxy, input-validation and caching categories still need a re-run when `/api/vam/*` lands.
- Workflow injection: `contract.yml` interpolates only `github.server_url`, `github.repository` and `github.run_id`. `smoke.yml` passes `environment_url` via env, not inline in `run:`. No `pull_request_target`. Permissions are `contents: read`. A check of the bypass-secret flow also found no leak through Playwright reporters or traces (trace is off when the secret is set).

## Info

- `permissionDecision: "ask"` from a PreToolUse hook is honoured by Claude Code in default and acceptEdits modes. I could not confirm it in `bypassPermissions` mode. The docs claim "every permission mode that honours hook decisions", which is suitably hedged.
- Relevant files:
  - D:\src\colourway-studio\.claude\hooks\guard.mjs
  - D:\src\colourway-studio\.claude\hooks\budget.mjs
  - D:\src\colourway-studio\.claude\hooks\lib-usage.mjs
  - D:\src\colourway-studio\.claude\settings.json
  - D:\src\colourway-studio\tests\e2e\trusted-origin.ts
  - D:\src\colourway-studio\tests\e2e\fixtures.ts
  - D:\src\colourway-studio\.github\workflows\smoke.yml
  - D:\src\colourway-studio\docs\threat-model.md
