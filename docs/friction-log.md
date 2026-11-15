# Friction log

Honest notes on where the agent or the tooling got in the way, written at the time it happened. Feeds "What I'd change" in the interview.

Template:

```
## YYYY-MM-DD HH:MM: short title
- **Doing:** what we were working on
- **What went wrong:** the agent's mistake, or the tooling problem
- **Resolved by:** what fixed it
- **Prevention:** CLAUDE.md rule / hook / prompt change / none needed
```

---

## 2026-11-15 13:34: Budget was set without measuring a baseline

- **Doing:** 001-tooling, wiring size-limit to the first-load JS gate in docs/quality-gates.md.
- **What went wrong:** Budget was set without measuring a baseline; caught by the gate itself before any app code. The 150 kB cap sat below the Next 16 / React 19 floor (measured 180.35 kB, cross-checked at 180.78 kB). My own first size-limit glob also summed every chunk, which would have counted lazy-loaded chunks as first-load. I flagged the problem before the proof step as instructed.
- **Resolved by:** Adam chose to raise the budget to 200 kB with ADR 0004; `.size-limit.mjs` now measures only the scripts `/` references.
- **Prevention:** Measure a baseline before setting any numeric gate, and record it in the ADR. The "stop and tell me if the baseline is near or over" step in the plan is what caught this, so keep it.

## 2026-11-15 14:05: Budget guard counted cache reads at full weight

- **Doing:** 001-tooling, a long review-and-fix session.
- **What went wrong:** The session limit summed raw tokens, cache reads included, so it blocked prompts at 10.3M "tokens" that were mostly cache reads billed at about a tenth of fresh input. The guard stopped real work well before real spend. The limit was never calibrated against an actual session, and the block message pointed the agent at the file that sets the limit.
- **Resolved by:** Session limits now count weighted tokens (input + output + cache writes + 0.1 × cache reads). Tests show a cache-read-heavy session does not trip it and a genuinely heavy one still does, and they fail if the weight is set back to 1. The message now says to ask Adam.
- **Prevention:** Calibrate a limit against a real session's ledger row before enforcing it. The guard now protects budget.json itself, so only Adam can raise it.

## 2026-11-15 14:10: npm ci could not install, so every CI job was red

- **Doing:** 001-tooling, adding size-limit for the bundle gate.
- **What went wrong:** `@size-limit/file@13` needs `size-limit@13.1.1` as a peer, but `size-limit` was left at `^12`. `npm install` locally tolerated it; `npm ci` fails with ERESOLVE, so checks, e2e, security, contract, mutation and smoke all failed at install. Nothing caught it until the code review ran `npm ci --dry-run`. The earlier session never ran `npm ci` or looked at CI.
- **Resolved by:** Bumped `size-limit` to `^13.1.1` and regenerated the lockfile; `npm ci --dry-run` now resolves.
- **Prevention:** After any dependency change, run `npm ci --dry-run` (or a clean install) before committing. Add it to the "before saying done" checklist. Never paper over a peer conflict with `--legacy-peer-deps`.

## 2026-11-15 15:20: A git checkout to undo a test break also discarded my own uncommitted edit

- **Doing:** 001-tooling, proof-by-breaking the CSP test by deleting the `worker-src` line.
- **What went wrong:** I reverted the deliberate break with `git checkout <file>`. The file also held my uncommitted `worker-src` addition, so the checkout removed the real change too. I noticed from the file-changed notice, re-applied it and re-ran the tests. No work was lost. The same slip with a broader path could have lost more.
- **Resolved by:** Re-applied the edit. For later breaks I copied the file aside first and restored from the copy.
- **Prevention:** Never undo a deliberate break with git on a file that has uncommitted work. Back up the file first, or commit before breaking.
