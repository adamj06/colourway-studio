## Re-review: feat/001-tooling, a6cc001..HEAD (9 commits, 97ed466 to 831e38a)

**Verdict: ship after fixes.** Most Phase A items are genuinely fixed. The guard.mjs rewrite fixes the reported cases but **regresses 15 shell write forms that the old guard blocked**. The tests don't catch this because they never compare against the old behaviour.

**What I ran:**

- `npm run lint`, `npm run typecheck` and `npm run format:check`: all clean.
- `npm run test -- --coverage`: 82 tests pass; 100% statements, branches and lines across the 2 covered files.
- `node --test ".claude/hooks/tests/*.test.mjs"`: 134 tests pass.
- `npx size-limit` on the existing `.next`: 180.35 kB, under the 200 kB limit.
- `npm ls size-limit`: resolves to 13.1.1 with no peer error.
- The pinned SHAs match upstream tags (`git ls-remote`): gitleaks-action v2.3.9 is `ff98106…`, and claude-code-action v1.0.276 peels to `f3b070c…`.
- commitlint `feature-trailer` checked on sample messages: it warns when `Feature:` is missing and is quiet when it's present.
- Probed the new and old guard.mjs side by side with a harness in the scratchpad: C:\Users\adamj\AppData\Local\Temp\claude\492507ab440d9bcf\8cc42dba-0c5a-428f-8a65-f9b16a359846\scratchpad\probe.mjs, cmds.txt and paths.txt.
  - The live guard blocked my first probe-file heredocs because they contained literal commands. So the probe data uses placeholders that the harness expands in-process. Nothing was written to any guardrail file.

---

### Must fix

1. **The command-position matching drops 15 write forms the old guard blocked.** Files: `.claude/hooks/guard.mjs:81-90` (`WRAPPERS`, `commandOf`) and `:145` (`segmentsOf`).
   - Each of these was BLOCK at a6cc001 and is allow now:
     - `(rm .claude/hooks/guard.mjs)`
     - `{ rm .claude/hooks/guard.mjs; }`
     - `if true; then rm .claude/hooks/guard.mjs; fi`
     - `env rm …`, `timeout 5 rm …`, `xargs rm …`
     - `bash -c "rm .claude/hooks/guard.mjs"`
     - `sh -c 'sed -i s/a/b/ .claude/settings.json'`
     - `find .claude/hooks -name guard.mjs -exec rm {} \;`
     - `true & rm …`, `$(rm …)`, `! rm …`, `"rm" …`
     - `sudo -u root rm …`, `nice -n 5 rm …`
   - Causes:
     - `segmentsOf` doesn't split on `&`, `(`, `)`, `{`, `` ` `` or `$(`.
     - `commandOf` takes the first token literally, so `(rm`, `then`, `!` and `"rm"` are never matched.
     - `WRAPPERS` lacks `env`, `timeout` and `xargs`, and doesn't skip wrapper options (`-u root`, `-n 5`).
     - `sh -c` and `bash -c` strings are never looked inside.
   - Also allowed, though the old guard missed them too: `find .claude/hooks … -delete`, `echo x >| .claude/budget.json`, `cp -r src .claude`, `rsync -a x/ .claude/`.
   - Simplest fix that fails closed: invert the logic.
     - If the first token is a known read-only command (`grep`, `rg`, `cat`, `head`, `tail`, `less`, `wc`, `ls`, `echo` with no redirect, or `git log|diff|show|status|blame`), treat the segment as a read.
     - Otherwise fall back to the old rule: a whole-token write verb anywhere in a segment that mentions a guardrail path.
     - Also split on `&`, `(`, `)`, `{`, `}`, `` ` `` and `$(`; strip leading `!`, `then`, `do` and `else`; and strip quotes and backslashes from the command token.
     - Add every command above to `guardrailWrites` in guard.test.mjs.
   - Until this is fixed, the threat-model "Known gaps" list (docs/threat-model.md:176-182) understates what gets through.

### Should fix

2. **`commitNoVerifyShort` creates new false positives and misses abbreviations.** Lines: `guard.mjs:160-163, 181-182, 189`.
   - The regex runs over the whole line, so these are blocked as "skipping git hooks":
     - `git commit -m "x" && git log -n 1`
     - `git commit -m x && head -n 5 README.md`
     - `git log --grep=commit -n 5`

     The first is a very common agent pattern.

   - Still allowed: `git commit --no-verif -m x` and `--no-veri`. Git accepts unique long-option abbreviations.
   - Also allowed: `HUSKY="0" git commit`.
   - Fix:
     - Evaluate per segment with `commandOf`: only when the command is `git` and `gitSubcommand(args) === 'commit'`, look for a short-flag cluster containing `n` in that segment's args.
     - Change the long-option rule to `/--no-ver/`.
     - Change the husky rule to `/\bHUSKY\s*=\s*["']?0\b/`.
     - Add the three false-positive commands to the allowed tests.

3. **Several quality-gate files are still unprotected (Phase A item 5, partly fixed).**
   - The Edit tool gets no "ask", and `sed -i` is allowed, on:
     - `tsconfig.json`: the Types gate (`strict`, `noUncheckedIndexedAccess`).
     - `package.json`: CI runs `npm run lint`/`test`, so `"lint": "true"` kills the gate.
     - `scripts/run-mutation.mjs`: it can be made to always "skip".
     - `.prettierignore`: adding `src/` turns off the format gate.
     - `playwright.config.ts`: hosts the axe gate.
     - `docs/quality-gates.md`: the contract itself.
     - `docs/cost/ledger.csv`: truncating it resets the daily USD figure. This one is documented as unprotected at threat-model.md:184.
   - Fix: add `tsconfig.json`, `package.json`, `scripts/run-mutation.mjs`, `.prettierignore`, `playwright.config.ts` and `docs/quality-gates.md` to the third `GUARDRAIL` alternative (guard.mjs ~44-46) and to the threat-model list (:172). For package.json, "ask" on every edit is acceptable: `npm install` is already an ask rule.

4. **The trusted-origin check trusts any `*.vercel.app` host, which anyone can register.** Line: `tests/e2e/trusted-origin.ts:20`.
   - The stated threat is an "attacker-influenced BASE_URL". Anyone who can create a deployment_status event (a token with `deployments: write`, or a third-party integration) can point it at their own `evil.vercel.app` and receive the project-wide bypass secret. The suffix check doesn't stop that.
   - Fix:
     - Match the project's own patterns, e.g. `/^colourway-studio-[a-z0-9-]+-<scope>\.vercel\.app$/` plus the production alias.
     - In smoke.yml, add `&& github.event.deployment_status.creator.login == 'vercel[bot]'` to the job `if`.
     - Update trusted-origin.test.ts so it rejects `https://evil.vercel.app`.

5. **`bypass-secret.spec.ts` passes vacuously everywhere except a live smoke run with the secret set (Phase A item 6, partly fixed).** Lines: `tests/e2e/bypass-secret.spec.ts:5-41`; claim at `docs/threat-model.md:41`.
   - In the CI `e2e` job there's no secret, so `toBeUndefined()` can't fail. A regression back to `extraHTTPHeaders` or `route.continue({headers})` would pass CI.
   - Secondary problem: `void req.allHeaders().then(push)` (:12) races the assertions. Collect the promises and `await Promise.all(...)` before asserting.
   - Fix:
     - Make the trust check injectable (a fixture option, e.g. `bypassTrust`). In this spec, `test.use({ bypassSecret: 'e2e-canary', bypassTrust: () => true })` and assert that no page request carries `e2e-canary`. That needs a local stub for the Node-side GET, or a tolerated failed GET.
     - Change the threat-model sentence to say when the assertion is meaningful.

6. **`setup-node@v4` and `checkout@v4` run unpinned in the same job as the bypass secret, and the "token-bearing" claim is wrong.** Lines: `.github/workflows/smoke.yml:16-17`; `docs/production-readiness.md:14`; `docs/threat-model.md:138`.
   - A compromised `setup-node` controls the node/npm that runs `npx playwright` with `VERCEL_AUTOMATION_BYPASS_SECRET` in its env.
   - `checkout`, `setup-node` and `codeql-action` all receive `github.token` by default, so "only the two token-bearing actions" is inaccurate.
   - Fix: SHA-pin every action in smoke.yml at least (Dependabot's github-actions ecosystem is configured, so it will keep the pins current), and reword both docs.

7. **The guard doesn't run for a PowerShell tool, if one is available.** Line: `.claude/settings.json:98`, matcher `Bash|Read|Edit|MultiEdit|Write|Grep|Glob`.
   - This machine's primary shell is PowerShell. If Claude Code exposes a `PowerShell` tool here, none of these apply to it: force push, push to main, `--no-verify`, `.env` reads, guardrail writes.
   - The threat model lists "anything run outside the Bash tool" as a gap, but that is cheap to close. I could not confirm the tool name from inside the repo.
   - Fix: add `PowerShell` to the matcher and handle `tool === 'PowerShell'` like Bash. `scriptedWrite` already knows the cmdlets.

8. **The bypass-mode behaviour of the hook's "ask" is asserted but not verified (Phase A item 4 / H2, partly fixed).** Line: `docs/threat-model.md:166`, "in every permission mode that honours hook decisions".
   - Phase A asked for the documented behaviour to be checked and recorded. The sentence is a hedge that is true by definition.
   - Fix: test it once, in a `bypassPermissions` session editing `.claude/budget.json`, and record the observed result. If it doesn't prompt, say so plainly.

### Nit

- **guard.mjs:79 (`ln` in `COPY_VERBS`):** `ln -s .claude/hooks/guard.mjs g` and `ln .claude/hooks/guard.mjs g` are allowed, and a later Edit of `g` gets no ask (a hard link writes straight through). Block `ln` when the guardrail path is the source, or add this to the Known gaps list.
- **guard.mjs:153-158:** `env -0`, `env > /tmp/e.txt` and `export -p` dump the environment. None of these is a regression; add them to the known gaps or the rule.
- **package.json:6:** `engines.node >=22.12`, but size-limit 13 needs `^22.18.0`. Local node is 22.17.0, already below it. Use `>=22.18`.
- **eslint.config.mjs:64-72:** `no-restricted-imports` bans the whole `node:process` module, so `import { argv } from 'node:process'` in scripts gets an env-specific message. Use `importNames: ['env']` plus the `p.env` syntax selector, or reword the message.
  - Also, any later flat-config block that sets `no-restricted-syntax`, which is likely for the "no DOM in lib/colour" rule, will silently replace these selectors for those files. Add a comment saying so.
- **eslint.config.mjs:71:** the `VariableDeclarator…ObjectPattern` selector is redundant. Phase A showed `no-restricted-properties` already catches destructuring, and the comment at :62 is wrong to say otherwise.
- **tests/e2e/fixtures.ts:22-26:** `failOnStatusCode: false` with no check, so a wrong secret fails later and confusingly, on a Vercel login page. Assert `res.status() < 400` or that a `_vercel_jwt` cookie exists.
- **tests/e2e/fixtures.ts:** the standalone `request` fixture still gets no bypass (Phase A item 6). Document "use `page.request`" for a future `/api/health` smoke test.
- **tests/e2e/home.spec.ts:36-37:**
  - `DEPLOY_ENV === 'production'` misses Vercel's "Production – <project>" environment name format.
  - Vercel's own `*.vercel.app` HSTS may already include `includeSubDomains`, which would make that assertion vacuous. Use `startsWith('production')`, and treat `upgrade-insecure-requests` as the real signal (or assert the exact HSTS value).
- **.github/workflows/contract.yml:30:** `gh label create … || true` also swallows auth errors. Use `gh label create --force`.
- **.claude/hooks/lib-usage.mjs:45:** the "weighted" metric is neither raw tokens nor cost-proportional: output counts 1x but costs about 5x input. With unchanged limits, it is a de facto ~10x loosening for cached sessions. Confirm Adam approved it as a limit change, or use cost-relative weights.
- **bypass-secret test and budget tests:** "cache reads count at one tenth" passes for any weight from about 0.091 to 0.19. Add a bracket case near 0.1 if the exact weight matters.
- **Carried over and not addressed:** `src/app/layout.tsx:16-17` still says "Create Next App", and the e2e job still rebuilds via `webServer`.
- **ADR 0003 worker-src:** check `worker-src 'self'` under `next dev` once the worker lands. Some dev bundlers wrap workers in blob: URLs.

### Tests I'd add

- guard.test.mjs, blocked: every Must 1 command, plus `find .claude/hooks -delete`, `echo x >| .claude/budget.json`, `cp -r src .claude`, `ln .claude/hooks/guard.mjs g`.
- guard.test.mjs, blocked: `git commit --no-veri -m x` and `HUSKY="0" git commit -m x`.
- guard.test.mjs, allowed: `git commit -m x && git log -n 1`, `git log --grep=commit -n 5`, `git commit -m x && head -n 5 README.md`.
- guard.test.mjs, ask: Edit on `tsconfig.json`, `package.json`, `scripts/run-mutation.mjs`, `.prettierignore`, `docs/quality-gates.md`.
- trusted-origin.test.ts: rejects `https://evil.vercel.app` and `https://colourway-studio.vercel.app.evil.test`; accepts a real preview pattern.
- e2e: the bypass spec with a canary secret and injected trust, so it fails if the header ever reaches a page request in CI.
- budget.test.mjs: weights 0.09 and 0.11 both distinguishable, if the exact weight matters.

---

### Phase A items

| Phase A item                                                                 | Status                           | Evidence                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CR Must 1 / Sec M6: npm ci peer conflict                                     | **Fixed**                        | size-limit ^13.1.1, lockfile regenerated, `npm ls` clean (engines nit above)                                                                                                                                                                                |
| CR Must 2: format:check in CI                                                | **Fixed**                        | ci.yml:27-28                                                                                                                                                                                                                                                |
| CR Must 3 / Sec H1: guard bypasses                                           | **Partly**                       | Reported cases fixed (bare `.claude`, `-t`, budget.json, grep false positive); `cd`, `dd` and `git apply` documented and pinned as known gaps. **15 new regressions** (Must 1)                                                                              |
| CR Should 4 / Sec H2: hook ask on Edit/Write                                 | **Fixed (behaviour unverified)** | guard.mjs:65-71 plus tests; bypass-mode behaviour hedged, not recorded (Should 8)                                                                                                                                                                           |
| CR Should 5 / Sec H3: budget.json, pricing.json and gate configs unprotected | **Partly**                       | budget, CLAUDE/AGENTS, vitest/stryker/size-limit/eslint/lint-staged/commitlint, .husky and workflows covered; tsconfig, package.json, run-mutation.mjs, .prettierignore, playwright.config and quality-gates.md not (Should 3); budget.mjs message reworded |
| CR Should 6: bypass-secret redirect leak plus cross-origin test              | **Partly**                       | Design fixed (one Node-side request, cookie); test vacuous outside smoke (Should 5); `request` fixture still unbypassed                                                                                                                                     |
| CR Should 7: vitest `src/app/**` exclusion                                   | **Fixed**                        | vitest.config.ts:17-22                                                                                                                                                                                                                                      |
| CR Should 8 / Sec M5: contract check presented as active                     | **Fixed**                        | threat-model, production-readiness and runbook say "planned"; label created, `\|\| true` removed from issue create                                                                                                                                          |
| CR Should 9: e2e header assertions                                           | **Fixed**                        | COOP, frame-ancestors, no unsafe-eval, worker-src, production HSTS and upgrade-insecure-requests (DEPLOY_ENV nit)                                                                                                                                           |
| CR Should 10 / Sec L1: process.env lint gaps                                 | **Fixed**                        | eslint.config.mjs:62-83, tests/unit/eslint-env-rule.test.ts (overbroad import ban nit)                                                                                                                                                                      |
| CR Should 11 / Sec L2: NODE_ENV fail-open                                    | **Fixed**                        | env.ts:5, env.test.ts:24-26                                                                                                                                                                                                                                 |
| CR Should 12: .prettierignore `.claude/`                                     | **Fixed**                        | .prettierignore:12                                                                                                                                                                                                                                          |
| Sec M1: `rm` false positive                                                  | **Fixed**                        | Reported cases allowed now; new `-n` false positives introduced (Should 2)                                                                                                                                                                                  |
| Sec M2: `commit -n`, hooksPath, HUSKY=0                                      | **Partly**                       | Those three blocked; `--no-veri`, `HUSKY="0"` slip through                                                                                                                                                                                                  |
| Sec M3: smoke secret exposed to PR code                                      | **Partly (accepted risk)**       | Documented as residual risk, rotation in runbook, trusted-origin check added, but `*.vercel.app` is too broad (Should 4); no creator check                                                                                                                  |
| Sec M4: SHA pinning                                                          | **Partly**                       | Two actions pinned with correct SHAs; secret-adjacent setup-node and checkout in smoke.yml unpinned; "token-bearing" wording inaccurate (Should 6)                                                                                                          |
| Sec L3: build-time HSTS and promote rule                                     | **Fixed**                        | runbook:21, threat-model:150                                                                                                                                                                                                                                |
| Sec L4: worker-src and img-src blob/data docs                                | **Fixed**                        | security-headers.ts:21-22 plus test, ADR 0003, threat-model:149-151                                                                                                                                                                                         |
| Sec L5: empty BASE_URL                                                       | **Fixed**                        | playwright.config.ts:5, smoke.yml empty check                                                                                                                                                                                                               |
| Sec L6: e2e artifact never gets the secret                                   | **Fixed**                        | ci.yml comment                                                                                                                                                                                                                                              |
| Nit: size-limit minimum count                                                | **Fixed**                        | .size-limit.mjs:19-24                                                                                                                                                                                                                                       |
| Nit: run-mutation and Stryker `.d.ts`                                        | **Fixed**                        | run-mutation.mjs:17, stryker.config.mjs:7                                                                                                                                                                                                                   |
| Nit: Stryker ignorePatterns                                                  | **Fixed**                        | stryker.config.mjs:9                                                                                                                                                                                                                                        |
| Nit: tautological env test, `(root)` branch                                  | **Fixed**                        | env.test.ts:28-30, 69-71                                                                                                                                                                                                                                    |
| Nit: lint-staged globs and `--no-warn-ignored`                               | **Fixed**                        | `.prettierrc` still not matched (trivial)                                                                                                                                                                                                                   |
| Nit: commitlint Feature trailer                                              | **Fixed**                        | Verified on sample messages                                                                                                                                                                                                                                 |
| Nit: guard `env;` anchor                                                     | **Fixed**                        | `echo a = env;` allowed                                                                                                                                                                                                                                     |
| Nit: stop-checks `.cjs/.mts/.cts`                                            | **Fixed**                        | stop-checks.mjs:17                                                                                                                                                                                                                                          |
| Nit: engines.node                                                            | **Partly**                       | Added, but should be >=22.18 for size-limit 13                                                                                                                                                                                                              |
| Nit: layout metadata; duplicate e2e build                                    | **Not fixed**                    | layout.tsx:16-17; ci.yml e2e still uses webServer                                                                                                                                                                                                           |

Key files: D:\src\colourway-studio\.claude\hooks\guard.mjs, D:\src\colourway-studio\.claude\hooks\tests\guard.test.mjs, D:\src\colourway-studio\tests\e2e\trusted-origin.ts, D:\src\colourway-studio\tests\e2e\bypass-secret.spec.ts, D:\src\colourway-studio\tests\e2e\fixtures.ts, D:\src\colourway-studio\.github\workflows\smoke.yml, D:\src\colourway-studio\docs\threat-model.md, D:\src\colourway-studio\docs\production-readiness.md, D:\src\colourway-studio\eslint.config.mjs, D:\src\colourway-studio\package.json
