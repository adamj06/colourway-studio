# ADR 0004: First-load JS budget set from a measured baseline

- **Status:** Accepted
- **Date:** 2026-11-15

## Context

`docs/quality-gates.md` originally capped first-load JS for `/` at 150 kB gzip. That number was chosen without measuring anything. When size-limit was wired up in feature 001-tooling, the starter app already measured **180.35 kB** gzipped, cross-checked at **180.78 kB** by gzipping the 7 scripts the built home page references. Almost all of it is the Next 16 and React 19 runtime, so 150 kB sat below the framework floor and the gate failed before any app code existed.

## Options considered

1. **Raise the limit to 200 kB.** Keeps a real, enforced gate with a deliberate margin.
2. **Keep 150 kB and trim.** Dropping starter assets cannot remove the framework runtime, so this can't get near the target.
3. **Redefine the gate** to measure only app-owned chunks. Changes what the gate means and hides the real cost users pay.

## Decision

Option 1: the budget is **200 kB gzip of first-load JS for `/`**, measured by size-limit over the scripts the built home page references (`.size-limit.mjs`). Lazy-loaded chunks are not first-load and are not counted.

## Consequences

- About 20 kB of headroom, on purpose. It forces the weight to stay off the first load:
  - The palette Web Worker and the export code must be **lazy-loaded** (dynamic import), never part of first-load.
  - Client-side parsing uses `zod/mini` rather than full zod.
- Any change that adds first-load JS needs to justify itself against the 20 kB.
- The measurement counts only scripts referenced by `/`. When more routes exist, add an entry per route.
- Lesson recorded in `docs/friction-log.md`: measure a baseline before setting a numeric gate.
