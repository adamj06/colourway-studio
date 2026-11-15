## Code review: feat/001-tooling vs main (D:\src\colourway-studio)

**Verdict: ship after fixes.** `npm ci` fails, so every CI job (checks, e2e, security, contract, mutation, smoke) is red before it reaches a single gate. That blocks merge on its own.

**What I ran:**

- `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run test -- --coverage` (56 tests) and `node --test ".claude/hooks/tests/*.test.mjs"` (61 tests) all pass locally.
- `npx size-limit` against the existing `.next` build passes: 180.35 kB against a 200 kB limit.
- `npm ci --dry-run` in a scratch copy of package.json and package-lock.json fails with ERESOLVE.
- I tested guard.mjs by piping the listed commands into it, and tested the ESLint rule with `--stdin` probes.

**Working tree:** `docs/cost/` is untracked and holds only `ledger.csv` (header plus 2 rows for this session). CLAUDE.md treats the ledger as an input to the "How this was built" page, and `.prettierignore` already lists it. Either commit it on this branch or decide it is gitignored. Otherwise a later `git add .` will sweep it into an unrelated feature.

---

### Must fix

1. **package.json:31 and :46: `npm ci` fails with ERESOLVE.** `@size-limit/file@13.1.1` needs peer `size-limit@"13.1.1"`, but `size-limit` is `^12.1.0`. `npm ls` shows `size-limit@12.1.0 invalid`. `npm ci --dry-run` exits with "Conflicting peer dependency: size-limit@13.1.1". Every workflow runs `npm ci`, so all of CI is broken.
   - Fix: set `"size-limit": "^13.1.1"` (or pin both to the same major), regenerate the lockfile with `npm install`, and commit it.
   - Do not paper over it with `--legacy-peer-deps` or an `.npmrc`.

2. **.github/workflows/ci.yml:24-34: Prettier is not checked in CI.** docs/quality-gates.md:7 says CI enforces formatting. The workflow has no `format:check` step, and lint-staged can be skipped by human commits. By the doc's own rule, a gate that only lives in a doc isn't a gate.
   - Fix: add `- run: npm run format:check` after `npm ci` in the `checks` job.

3. **.claude/hooks/guard.mjs:40-73: the guardrail tripwire misses the most natural write commands and blocks a harmless read.** Probe results:

   | Command                                       | Result                       |
   | --------------------------------------------- | ---------------------------- |
   | `cd .claude/hooks && sed -i s/a/b/ guard.mjs` | allowed                      |
   | `git restore .claude/`                        | allowed                      |
   | `git checkout main -- .claude`                | allowed                      |
   | `echo {} > .claude/budget.json`               | allowed                      |
   | `cp -t .claude/hooks x`                       | allowed                      |
   | `cd .claude && mv hooks h`                    | allowed                      |
   | `dd of=.claude/hooks/guard.mjs`               | allowed                      |
   | `git apply evil.patch`                        | allowed                      |
   | `grep -n rm .claude/hooks/guard.mjs`          | **blocked** (false positive) |

   Causes:
   - `GUARDRAIL` requires `.claude/(settings|hooks|agents|commands)`, so a bare `.claude` or `.claude/` never matches.
   - Path checks are per segment, so a `cd` in an earlier segment hides the target.
   - `lastArg` ignores `-t DIR`.
   - The verb test at :58 (`\b(tee|mv|...|rm|...)\b`) matches anywhere in the segment, so a grep for "rm" counts as a write.

   The threat model calls the hook "best-effort", but this feature's whole point (commit 0358e21) is these cases, and its tests don't exercise any of them. Fix:
   - Treat bare `\.claude(?=$|[\s/\\'"])` as a guardrail path for `git (checkout|restore|stash|apply|clean)`.
   - Flag any command that `cd`s into `.claude` and then runs a write verb.
   - Handle `cp/mv/install -t DIR` and `dd of=`.
   - Only match write verbs at command position, e.g. `/^\s*(?:sudo\s+)?(tee|mv|rm|…)\b/` on the trimmed segment.
   - Add every command in the table above to guard.test.mjs: the first eight as blocked, the grep as allowed.

### Should fix

4. **.claude/settings.json:32-46 and guard.mjs:37-39: Edit/Write protection depends on permission mode.** Protection relies only on settings `ask` rules. guard.test.mjs locks the weakness in by asserting that Edit and Write on guardrail files exit 0 (the two "leaves Edit/Write … to the ask rules" tests). threat-model.md:26 admits `ask` rules are not enforced in bypass-permissions modes. The `./.claude/...` patterns are also cwd-relative, so they won't match if the session starts in a subdirectory.
   - Fix: in guard.mjs, for Edit, MultiEdit, Write (and NotebookEdit) on guardrail paths, print `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"guardrail file"}}` and exit 0.
   - Change the two tests to assert that JSON.
   - Check in the hooks docs how bypass mode treats a hook's `ask`, and record the result in the threat model.

5. **The budget files and quality-gate configs are not protected.**
   - `.claude/budget.json` is in neither `GUARDRAIL` nor the `ask` rules, and `echo {} > .claude/budget.json` is allowed.
   - The daily USD figure also reads `docs/cost/ledger.csv`, which the agent can edit or truncate freely.
   - budget.mjs:22 still says "Edit .claude/budget.json if this is deliberate." For a UserPromptSubmit exit 2, stderr goes to the user, not the model, so the wording itself is low risk. The real problem is that the file it points to is unprotected.
   - The same gap covers what CLAUDE.md says must never be lowered: vitest.config.ts thresholds, stryker.config.mjs `break`, .size-limit.mjs, eslint.config.mjs, lint-staged/commitlint configs, `.husky/**` and `.github/workflows/**`.
   - Fix: add these paths to the `ask` rules and to `GUARDRAIL`. Reword budget.mjs:22 to "Ask Adam to raise the limit in .claude/budget.json".
   - pricing.json lives at `.claude/hooks/pricing.json`, so it is already covered (see verification table).

6. **tests/e2e/fixtures.ts:14-21: the bypass secret can still leave the origin, and no test proves it doesn't.**
   - Playwright's `route.continue({ headers })` override also applies to redirects the routed request triggers. A same-origin URL that 30x-redirects to a third party (an image redirect to framemark is likely in a proxy app, as is Vercel's SSO redirect) would carry `x-vercel-protection-bypass` with it.
   - The `request` fixture (APIRequestContext) gets no bypass at all, so a future `/api/health` smoke test would get a 401 on protected previews.
   - Fix: drop routing. In a fixture, call `context.request.get(baseURL, { headers: { 'x-vercel-protection-bypass': secret, 'x-vercel-set-bypass-cookie': 'true' }, maxRedirects: 0 })` once. That sets the host-only bypass cookie, which shares storage with the browser context and never leaves the origin.
   - Add a test that loads a page with a cross-origin request (`page.route('https://example.test/**', r => { captured = r.request().headers(); r.fulfill({ body: '' }) })`) and asserts `captured['x-vercel-protection-bypass']` is undefined.

7. **vitest.config.ts:15: `src/app/**` is excluded from coverage.** CLAUDE.md puts all server code in route handlers under `src/app/api/**/route.ts`, including the SSRF allowlist, the health check and typed error JSON. All of it will escape the 80% gate.
   - Fix: `exclude: ['src/app/**/*.tsx', 'src/app/**/{layout,page,error,not-found,loading}.tsx', '**/*.test.{ts,tsx}', '**/*.d.ts']`. That keeps `.ts` route handlers in.

8. **docs/threat-model.md:23 and docs/production-readiness.md:9 present the contract check as active.** vitest.contract.config.ts:10 sets `passWithNoTests: true`, and `tests/contract/` doesn't exist. contract.yml goes green every day while checking nothing.
   - Fix: say "planned (no contract tests yet; job passes vacuously)" until feature 002 adds them.
   - Or remove `passWithNoTests` and gate the workflow step on the directory existing, so the job can't silently pass once tests are expected.

9. **tests/e2e/home.spec.ts:12-28: the header smoke test misses the regressions that matter.**
   - Missing assertions: `Cross-Origin-Opener-Policy: same-origin`, `frame-ancestors 'none'`, and that `'unsafe-eval'` is absent. The last one catches a build that ran with `NODE_ENV` unset or set to development (see item 11).
   - On a live deploy nothing HSTS-related is asserted.
   - Fix: add those assertions unconditionally. When `BASE_URL` targets production, assert `strict-transport-security` contains `includeSubDomains` and the CSP contains `upgrade-insecure-requests`. That needs an env flag, e.g. pass `DEPLOY_ENV: ${{ github.event.deployment_status.environment }}` in smoke.yml.
   - Caveat: Vercel may add its own HSTS on `*.vercel.app`, so assert on `includeSubDomains` and on the CSP directive, not just on the header existing.

10. **eslint.config.mjs:54-61: the `process.env` ban is incomplete.** Probes against `src/config/probe.mjs`:
    - Caught: `process.env.X`, `process['env']`, and destructuring (`const { env } = process`, `const { env: e } = process`).
    - Missed: `import { env } from 'node:process'`, `import * as p from 'node:process'; p.env`, `import q from 'node:process'; q.env`, `globalThis.process.env`.
    - Fix: add `no-restricted-imports` with `paths: [{ name: 'node:process', importNames: ['env'] }, { name: 'process', importNames: ['env'] }]`, plus `no-restricted-syntax` for `MemberExpression[property.name='env'][object.property.name='process']`. Keep the existing exemptions.

11. **src/env.ts:4: `NODE_ENV` defaults to `'development'`, which fails open.** If it is ever unset in a build, the production CSP gains `'unsafe-eval'` (security-headers.ts:13).
    - Fix: default to `'production'` (fail closed) or make it required. Update the test at env.test.ts:24-26.

12. **`npm run format` is allow-listed (settings.json:9) and rewrites `.claude/**`.** `.prettierignore` doesn't exclude `.claude/`, so this sidesteps the `ask` rules. The style commit 50a7f3a did exactly that to the hooks. The post-edit hook is not the problem.
    - Fix: add `.claude/` to `.prettierignore`. Hooks are still linted.

### Nit

- **.size-limit.mjs:17:** it only guards against zero scripts. Assert a minimum count (e.g. ≥ 3) or that a known runtime chunk is present, so an HTML change that halves the matches doesn't quietly pass.
- **scripts/run-mutation.mjs:16:** `/\.ts$/` counts `.d.ts` files as mutable. Use `/(?<!\.d)\.ts$/`. Also exclude `.d.ts` in stryker.config.mjs:7.
- **stryker.config.mjs:** no `ignorePatterns`, so Stryker copies `.next/`, `coverage/` and `reports/` into the sandbox. Add them.
- **src/config/security-headers.ts:14-25:** no explicit `worker-src`. Add `worker-src 'self' blob:` (or `'self'`) deliberately before the palette worker lands. Right now it falls back to `script-src`.
- **src/env.test.ts:64-69:** tautological. `NODE_ENV` always has a default, so `toBeTruthy()` can't fail. Assert `mod.env.NODE_ENV === 'test'` (Vitest sets it) or delete the test.
- **src/env.ts:17:** the `'(root)'` branch is untested (coverage shows 75% branches, line 17). Add `parseEnv(null as never)` and assert `/\(root\)/`.
- **lint-staged.config.mjs:3:** add `cjs,mts,cts`. Line 4: add `yaml` and `.prettierrc`. Pass `--no-warn-ignored` to eslint so a staged ignored file doesn't fail on `--max-warnings 0`.
- **commitlint.config.mjs:6:** no rule for the `Feature:` trailer that CLAUDE.md requires. Add `'trailer-exists': [1, 'always', 'Feature:']`. commitlint keys rules by name, so use a plugin or a custom rule for the second trailer. Commit 0358e21 has neither trailer, which proves the gap.
- **ci.yml:** the e2e job rebuilds via Playwright's `webServer` after `checks` already built. Upload `.next` as an artifact or accept the duplication knowingly.
- **guard.mjs:84:** `env` followed by `;` anywhere (e.g. `echo a = env;`) is blocked as "dumping environment variables". Anchor it to command position.
- **stop-checks.mjs:17:** the code-changed regex misses `.cjs/.mts/.cts`.
- **package.json:** no `engines.node`. Vitest 5 and commitlint 21 need `>=22.12`.
- **src/app/layout.tsx:** metadata is still "Create Next App".

### Tests I'd add

- guard.test.mjs, as blocked: all eight bypass commands in item 3, plus `git stash` with `.claude` paths and `cp -t .claude/agents x`.
- guard.test.mjs, as allowed: `grep -n rm .claude/hooks/guard.mjs`, `grep -n "mv" .claude/settings.json`, `echo a = env;`.
- guard.test.mjs: Edit and Write on `.claude/hooks/x.mjs`, `.claude/budget.json` and `vitest.config.ts` output `permissionDecision: "ask"` JSON.
- e2e: cross-origin request captures no bypass header (item 6), and a same-origin request redirected to a third-party origin carries no bypass header.
- e2e: COOP, `frame-ancestors 'none'`, no `'unsafe-eval'`, and on production HSTS with `includeSubDomains` plus `upgrade-insecure-requests`.
- env.test.ts: `'(root)'` error message; NODE_ENV unset gives `'production'` after the item 11 fix; `env.NODE_ENV === 'test'` under Vitest.
- ESLint rule test: a fixture file per evasion form, run with `eslint --stdin` in a small node test that asserts each is reported.
- run-mutation: a temp directory containing only `x.d.ts` is skipped.

---

### Verification of previously reported items

| #   | Item                                                                                                                                                               | Still applies?                   | Evidence                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | npm ci peer conflict, size-limit ^12 vs @size-limit/file 13                                                                                                        | **Yes**                          | package.json:31,46. `npm ls` shows "size-limit@12.1.0 invalid: "13.1.1" from @size-limit/file". `npm ci --dry-run` in a scratch copy fails with ERESOLVE.                                                                                         |
| 2   | ci.yml doesn't run format:check although quality-gates.md says CI enforces Prettier                                                                                | **Yes**                          | ci.yml steps: npm ci, hook tests, lint, typecheck, test --coverage, build, size-limit. No format step. quality-gates.md:7 says "CI".                                                                                                              |
| 3   | Playwright bypass-secret scoping, plus a test proving cross-origin requests don't get it                                                                           | **Partly fixed**                 | playwright.config.ts no longer uses `extraHTTPHeaders`. fixtures.ts:14 routes only `${origin}/**`. Still open: redirect inheritance of `route.continue` headers, no coverage for the `request` fixture, and **no test** for cross-origin absence. |
| 4   | Vitest coverage excludes src/app/\*\* (should exclude only .tsx/layout/page)                                                                                       | **Yes**                          | vitest.config.ts:15 `exclude: ['src/app/**', ...]`.                                                                                                                                                                                               |
| 5a  | .claude/budget.json not guardrail-protected                                                                                                                        | **Yes**                          | Not in settings.json `ask` rules or the guard.mjs:40-41 regex. `echo {} > .claude/budget.json` and `rm -f .claude/budget.json` are both allowed.                                                                                                  |
| 5b  | pricing.json not protected                                                                                                                                         | **No (stale)**                   | The file is `.claude/hooks/pricing.json`, covered by `Edit/Write(./.claude/hooks/**)` and the `hooks/` regex.                                                                                                                                     |
| 5c  | Budget message tells the agent to edit them                                                                                                                        | **Text still present, low risk** | budget.mjs:22. It only appears on exit-2 (stderr, shown to the user). The soft-limit stdout note (:49) doesn't include it.                                                                                                                        |
| 6   | Guard bypasses: `cd .claude/hooks && sed -i ...`, `git restore .claude/`, `git checkout main -- .claude`, `echo {} > .claude/budget.json`, `cp -t .claude/hooks x` | **Yes, all five allowed**        | Probed guard.mjs directly. Exit 0 for each.                                                                                                                                                                                                       |
| 6b  | False positive `grep -n rm .claude/hooks/guard.mjs`                                                                                                                | **Yes, still blocked**           | Exit 2, "writing to guardrail files". Cause: guard.mjs:58 matches the verb anywhere in the segment.                                                                                                                                               |
| 7   | Edit/Write guardrail protection depends on permission mode (hook should return permissionDecision "ask")                                                           | **Yes**                          | guard.mjs:37-39 defers to settings rules. guard.test.mjs asserts Edit and Write exit 0. threat-model.md:26 concedes bypass mode.                                                                                                                  |
| 8a  | threat-model.md not updated for guardrail protection                                                                                                               | **Fixed**                        | threat-model.md:26 now describes the hook, the `ask` rules and the bypass-mode caveat.                                                                                                                                                            |
| 8b  | threat-model.md claims actions are pinned to SHAs                                                                                                                  | **Fixed**                        | threat-model.md:24 says "pinned to major version tags (SHA pinning is a known gap…)", which matches the workflows (`@v4`, `@v3`, `@v2`, `@v1`).                                                                                                   |
| 8c  | Contract check presented as active though passWithNoTests                                                                                                          | **Yes**                          | threat-model.md:23, production-readiness.md:9 and runbook "Quality commands" all say so. vitest.contract.config.ts:10 has `passWithNoTests: true` and `tests/contract/` doesn't exist.                                                            |
| 9   | e2e header test doesn't assert 'unsafe-eval' absent, COOP same-origin, or HSTS on production smoke                                                                 | **Yes, all three**               | home.spec.ts:17-27 checks only img-src, nosniff, referrer, XFO, a truthy permissions-policy and x-powered-by. HSTS is checked only for absence, and only when there is no BASE_URL.                                                               |
| 10  | process.env lint rule misses destructuring and node:process imports                                                                                                | **Partly stale**                 | Destructuring **is** caught (probed both forms). `node:process` named, namespace and default imports and `globalThis.process.env` are **missed**.                                                                                                 |
| 11  | .prettierignore should exclude .claude/                                                                                                                            | **Yes**                          | .prettierignore has no `.claude/` entry.                                                                                                                                                                                                          |
| 12  | size-limit script-count check                                                                                                                                      | **Yes**                          | .size-limit.mjs:17 only rejects zero scripts.                                                                                                                                                                                                     |
| 13  | run-mutation counts .d.ts files                                                                                                                                    | **Yes**                          | run-mutation.mjs:16 `/\.ts$/` matches `.d.ts`.                                                                                                                                                                                                    |
| 14  | No explicit worker-src                                                                                                                                             | **Yes**                          | security-headers.ts:14-25.                                                                                                                                                                                                                        |
| 15  | Tautological env test                                                                                                                                              | **Yes**                          | env.test.ts:64-69.                                                                                                                                                                                                                                |
| 16  | Untested '(root)' branch in env.ts                                                                                                                                 | **Yes**                          | Coverage report: env.ts branches 75%, uncovered line 17.                                                                                                                                                                                          |
| 17  | lint-staged glob missing .cjs/.mts/.cts                                                                                                                            | **Yes**                          | lint-staged.config.mjs:3 `'*.{ts,tsx,js,jsx,mjs}'`.                                                                                                                                                                                               |
| 18  | commitlint doesn't warn on a missing Feature: trailer                                                                                                              | **Yes**                          | commitlint.config.mjs:6 checks only `Claude-Model:`. Commit 0358e21 has no Feature trailer and nothing flagged it.                                                                                                                                |

---

## Carried over from the earlier review

The code reviewer was given the earlier review's list and checked every item (table above), so none was missed outright. Status of each, as checked on 2026-11-15:

**Still applies, covered by a new-review finding (see the numbered items above):** npm ci peer conflict (Must 1), format:check in CI (Must 2), guard bypasses and the `grep rm` false positive (Must 3), Edit/Write depends on permission mode (Should 4), budget.json unprotected (Should 5), vitest `src/app/**` exclusion (Should 7), contract check presented as active (Should 8), e2e header assertions (Should 9), `process.env` rule gaps (Should 10), `.prettierignore` (Should 12), and the nits: size-limit count, run-mutation `.d.ts`, `worker-src`, tautological env test, `'(root)'` branch, lint-staged glob, commitlint `Feature:` trailer.

**Partly fixed or stale since the earlier review:**

- Playwright bypass secret: no longer `extraHTTPHeaders`; now scoped by route to our own origin (commit 4fc1426). Still open: redirect inheritance, the `request` fixture, and the missing cross-origin test (Should 6).
- `pricing.json` protection: stale. It lives at `.claude/hooks/pricing.json`, already covered. `budget.json` is not.
- Budget message: text is still in `budget.mjs:22`, but it is shown to the user only (exit 2 stderr). Still reword it as you asked.
- threat-model.md guardrail protection and SHA-pinning claims: both fixed. The contract-check claim is not.
- `process.env` destructuring: caught already. Only `node:process` imports and `globalThis.process.env` are missed.

**Missed by the new code review, caught by the security review:** the earlier items all appear above. The security review adds findings the code review did not raise: smoke workflow exposes the bypass secret to PR-controlled code (M3), actions not pinned to SHAs (M4), `contract.yml` swallows issue-creation failure with `|| true` (M5), `git commit -n` and `core.hooksPath` skip hooks (M2), and `HSTS`/`VERCEL_ENV` evaluated at build time (L3). See `001-tooling-security-review.md`.
