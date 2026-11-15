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
