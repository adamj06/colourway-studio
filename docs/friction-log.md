# Friction log

Honest notes on where the agent or the tooling got in the way, written at the time it happened. Feeds "What I'd change" in the interview.

## Summary: who caught it (001 tooling, 19 entries)

| Caught by         | Entries | Which                              |
| ----------------- | ------- | ---------------------------------- |
| human             | 7       | 1, 2, 8, 9 (diagnosis), 14, 18, 19 |
| hook              | 4       | 7, 9 (it fired), 14, 17            |
| human plan review | 3       | 3, 4, 5                            |
| reviewer agent    | 2       | 10, 11                             |
| CI                | 2       | 15, 16                             |
| agent itself      | 2       | 6, 12                              |
| commit hooks      | 1       | 13                                 |

Entries 9 and 14 were caught jointly (hook plus human), so they count in both rows; the counts sum to 21 across 19 entries.

Template:

```
## YYYY-MM-DD HH:MM: short title
- **Doing:** what we were working on
- **What went wrong:** the agent's mistake, or the tooling problem
- **Resolved by:** what fixed it
- **Prevention:** CLAUDE.md rule / hook / prompt change / none needed
- **Caught by:** human plan review / reviewer agent / CI / hook / commit hooks / agent itself / human
```

---

## 2026-11-15 12:56: create-next-app's AGENTS.md was invisible to Claude Code

- **Doing:** 001-tooling, first look at the scaffolded project.
- **What went wrong:** `create-next-app` generated `AGENTS.md` (version-matched Next 16 guidance), but Claude Code only reads `CLAUDE.md`, so the agent would never have seen it.
- **Resolved by:** An `@AGENTS.md` import in `CLAUDE.md`.
- **Prevention:** Check which instruction files the agent actually loads after scaffolding.
- **Caught by:** human

## 2026-11-15 13:04: Windows CRLF vs LF tooling noise

- **Doing:** 001-tooling, the first commit.
- **What went wrong:** Git warned about CRLF/LF conversion on every file before the first commit; formatters and hooks would have disagreed with the working tree.
- **Resolved by:** `.gitattributes` with `eol=lf`.
- **Prevention:** Add `.gitattributes` in the scaffold step on Windows.
- **Caught by:** human

## 2026-11-15 13:15: The 001 plan pre-decided the CORS spike outcome

- **Doing:** 001-tooling, plan review for the CSP.
- **What went wrong:** The plan set `img-src 'self'` "via our proxy" before the spike had run. The spike later showed `framemark.vam.ac.uk` sends `Access-Control-Allow-Origin: *`, so the proxy would have wasted Vercel bandwidth.
- **Resolved by:** Plan corrected before any code; the CSP follows the spike result.
- **Prevention:** Plans must not assume the result of a spike that is still to run.
- **Caught by:** human plan review

## 2026-11-15 13:15: HSTS keyed on NODE_ENV, but local `next start` is production

- **Doing:** 001-tooling, plan review for security headers.
- **What went wrong:** The plan keyed HSTS and `upgrade-insecure-requests` on `NODE_ENV`. Local `next start` is also production, so plain-http e2e runs would have got them and broken.
- **Resolved by:** Switched to `VERCEL_ENV === 'production'`.
- **Prevention:** Key deploy-only behaviour on the deploy environment, not the build mode.
- **Caught by:** human plan review

## 2026-11-15 13:15: Other gaps in the 001 plan

- **Doing:** 001-tooling, plan review of lint and mutation setup.
- **What went wrong:** `max-lines-per-function` would flag test `describe` blocks; type-aware lint would error on `.mjs` and hooks; `no-console` would block the upcoming logger; Stryker's behaviour with zero files was unknown.
- **Resolved by:** Per-file lint overrides, a logger exemption plan, and a clean no-op Stryker config.
- **Prevention:** Dry-run new lint rules against the existing tree before writing the plan.
- **Caught by:** human plan review

## 2026-11-15 13:34: Budget was set without measuring a baseline

- **Doing:** 001-tooling, wiring size-limit to the first-load JS gate in docs/quality-gates.md.
- **What went wrong:** Budget was set without measuring a baseline; caught by the gate itself before any app code. The 150 kB cap sat below the Next 16 / React 19 floor (measured 180.35 kB, cross-checked at 180.78 kB). My own first size-limit glob also summed every chunk, which would have counted lazy-loaded chunks as first-load. I stopped and flagged it instead of changing the limit, as instructed.
- **Resolved by:** Adam chose to raise the budget to 200 kB with ADR 0004; `.size-limit.mjs` now measures only the scripts `/` references.
- **Prevention:** Measure a baseline before setting any numeric gate, and record it in the ADR. The "stop and tell me if the baseline is near or over" step in the plan is what caught this, so keep it.
- **Caught by:** hook

## 2026-11-15 13:37: Vitest 5.1 peer conflict with @types/node 20

- **Doing:** 001-tooling, adding the test dependencies.
- **What went wrong:** Vitest 5.1 wants a newer `@types/node` than the pinned 20, so install failed on the peer range.
- **Resolved by:** The agent bumped `@types/node` to `^22` to match CI instead of using `--force` or `--legacy-peer-deps`.
- **Prevention:** None needed; this is the behaviour to keep (good behaviour, worth recording).
- **Caught by:** agent itself

## 2026-11-15 14:05: Budget guard counted cache reads at full weight

- **Doing:** 001-tooling, a long review-and-fix session.
- **What went wrong:** The session limit summed raw tokens, cache reads included, so it blocked prompts at 10.3M "tokens" that were mostly cache reads billed at about a tenth of fresh input. It also blocked the reviewer's hand-back, so the review was lost and had to be re-run in a fresh session. The limit was never calibrated against an actual session, and the block message pointed the agent at the file that sets the limit.
- **Resolved by:** Session limits now count weighted tokens (input + output + cache writes + 0.1 × cache reads). Tests show a cache-read-heavy session does not trip it and a genuinely heavy one still does, and they fail if the weight is set back to 1. The message now says to ask Adam.
- **Prevention:** Calibrate a limit against a real session's ledger row before enforcing it. The guard now protects budget.json itself, so only Adam can raise it.
- **Caught by:** hook (it fired) + human (diagnosis)

## 2026-11-15 14:08: "Read-only" reviewer agents still had Bash

- **Doing:** 001-tooling, the Phase A code and security reviews.
- **What went wrong:** The reviewer agents have Bash, so they can write files (scratch dirs). One also tried to probe the guard hook and was blocked by the guard and by auto mode's classifier.
- **Resolved by:** Noted as a known gap in the threat model; no code change yet.
- **Prevention:** Real read-only needs a sandbox or a narrow Bash allow-list.
- **Caught by:** hook + human

## 2026-11-15 14:10: npm ci could not install, so every CI job was red

- **Doing:** 001-tooling, adding size-limit for the bundle gate.
- **What went wrong:** `@size-limit/file@13` needs `size-limit@13.1.1` as a peer, but `size-limit` was left at `^12`. `npm install` locally tolerated it, and `npm ci` only appeared to work because `node_modules` already existed; on a clean checkout it fails with ERESOLVE, so checks, e2e, security, contract, mutation and smoke would all have failed at install. The earlier session never ran `npm ci` or looked at CI.
- **Resolved by:** Bumped `size-limit` to `^13.1.1` and regenerated the lockfile; `npm ci --dry-run` now resolves.
- **Prevention:** After any dependency change, run `npm ci --dry-run` (or a clean install) before committing. Add it to the "before saying done" checklist. Never paper over a peer conflict with `--legacy-peer-deps`.
- **Caught by:** reviewer agent

## 2026-11-15 14:30: The agent could edit its own guardrail files without asking

- **Doing:** 001-tooling, a `lib-usage.mjs` refactor and a `settings.json` reformat.
- **What went wrong:** Nothing stopped the agent editing the hooks, settings and gate configs that constrain it.
- **Resolved by:** `ask` rules in settings first, then the guard hook's own `ask` decision for Edit/Write/MultiEdit of guardrail files.
- **Prevention:** Guardrail files stay behind an approval prompt; the shell guard is a tripwire, not the control.
- **Caught by:** human

## 2026-11-15 15:00: Edited the e2e test and committed without re-running lint

- **Doing:** 001-tooling, changing the e2e bypass-secret test.
- **What went wrong:** The agent committed the edit without re-running lint first.
- **Resolved by:** The lint-staged hook rejected the commit; fixed and recommitted.
- **Prevention:** Run lint before committing, not only on Stop.
- **Caught by:** commit hooks

## 2026-11-15 15:20: A git checkout to undo a test break also discarded my own uncommitted edit

- **Doing:** 001-tooling, proof-by-breaking the CSP test by deleting the `worker-src` line.
- **What went wrong:** I reverted the deliberate break with `git checkout <file>`. The file also held my uncommitted `worker-src` addition, so the checkout removed the real change too. I noticed from the file-changed notice, re-applied it and re-ran the tests. No work was lost. The same slip with a broader path could have lost more.
- **Resolved by:** Re-applied the edit. For later breaks I copied the file aside first and restored from the copy.
- **Prevention:** Never undo a deliberate break with git on a file that has uncommitted work. Back up the file first, or commit before breaking.
- **Caught by:** agent itself

## 2026-11-15 15:30: Context bloat in the 001 session

- **Doing:** 001-tooling, one long session across several phases.
- **What went wrong:** Context reached about 285k.
- **Resolved by:** The status line warned, and the session was cleared between phases.
- **Prevention:** `/clear` between phases; keep the status-line warning.
- **Caught by:** hook (status line / budget note)

## 2026-11-15 15:40: The guard rewrite regressed 15 shell write forms

- **Doing:** 001-tooling, hardening the guard hook.
- **What went wrong:** The agent's rewrite of the guard dropped 15 shell write forms that the earlier version blocked.
- **Resolved by:** Restored the forms, with tests, and protected more gate files (1bd391d).
- **Prevention:** Keep a regression test per blocked form before rewriting the guard.
- **Caught by:** reviewer agent (second round)

## 2026-11-15 16:25: Typecheck depended on a stale .next/types

- **Doing:** 001-tooling, CI typecheck.
- **What went wrong:** Typecheck relied on `.next/types` (`LayoutProps`) left over from a previous local build; a clean CI checkout failed. Reproduced locally by deleting `.next`.
- **Resolved by:** `next typegen && tsc --noEmit` (3724b45).
- **Prevention:** Reproduce CI failures from a clean checkout before trusting a local pass.
- **Caught by:** CI

## 2026-11-15 16:40: Claude PR review action would not run

- **Doing:** 001-tooling, the Claude PR review workflow.
- **What went wrong:** Missing `id-token: write` (OIDC); Dependabot runs never get repo secrets; and the action deliberately skips credentials on a PR that modifies its own workflow, so the fix PR could not verify itself.
- **Resolved by:** Granted `id-token`, skipped Dependabot, re-run on push (50264d2).
- **Prevention:** Expect a workflow-changing PR to be unreviewable by its own action; verify on the next PR.
- **Caught by:** CI

## 2026-11-15 16:50: Tooling took about 2 hours against about 1 hour planned

- **Doing:** 001-tooling overall.
- **What went wrong:** The phase ran at roughly double the planned time.
- **Resolved by:** Scope was trimmed deliberately: guard hardening time-boxed, GitHub Environment and the rest of 1b deferred.
- **Prevention:** Time-box hardening work in the plan.
- **Caught by:** human

## 2026-11-15 16:55: The guard hook matcher only covers built-in tools

- **Doing:** 001-tooling, listing the agent's tools at the start of a fresh session.
- **What went wrong:** MCP tools bypass the guard, including `claude-in-chrome`, which acts in my signed-in browser (Vercel, GitHub) and could get around the `vercel --prod` and push-to-main blocks.
- **Resolved by:** Unused MCP servers are denied in `settings.json`, with a test (d20c367); the threat model notes it.
- **Prevention:** Re-check the tool list and deny unused servers whenever a connector is added.
- **Caught by:** human, while reviewing the tool list
