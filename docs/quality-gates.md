# Quality gates

The contract every change has to meet. The **Enforced by** column matters: a gate that only lives in a doc isn't a gate.

| Gate | Threshold | Enforced by |
|---|---|---|
| Formatting | Prettier clean | PostToolUse hook (Claude), lint-staged (human), CI |
| Lint | ESLint, zero warnings, `typescript-eslint` strict-type-checked, `jsx-a11y` recommended | PostToolUse hook, lint-staged, CI |
| Complexity | cyclomatic `complexity` ≤ 10, `max-depth` ≤ 3, `max-lines-per-function` ≤ 60 (UI components ≤ 120) | ESLint |
| Types | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, no `any`, no `@ts-ignore` (use `@ts-expect-error` with a reason) | `tsc --noEmit` in Stop hook and CI; ESLint |
| Unit coverage, `src/lib/**` | ≥ 95% lines and branches | Vitest `coverage.thresholds` (CI fails below) |
| Unit coverage, overall | ≥ 80% lines | Vitest `coverage.thresholds` |
| Mutation score, `src/lib/colour/**` | ≥ 80% (break), ≥ 90% (high) | Stryker `thresholds.break` |
| Accessibility | zero axe violations (serious or critical) on every page | `@axe-core/playwright` in e2e |
| Bundle size | first-load JS for `/` ≤ 150 kB gzip | `size-limit` in CI |
| Security | no secrets, no high or critical `npm audit` issues in prod deps, Semgrep clean | gitleaks, npm audit, Semgrep (CI) |
| Commits | Conventional Commits; `Claude-Model:` trailer when Claude wrote the change | commitlint (commit-msg hook) |
| Review | `code-reviewer` + `security-reviewer` run, all Must fix / Critical / High resolved | `/feature` and `/ship` workflow; CI Claude review on the PR |
| Dependencies | weekly update PRs, grouped | Dependabot |

## Why these numbers
- 95% on `lib/` because that's where the logic (and the risk) lives. UI coverage is measured by e2e, not by chasing line counts on JSX.
- Mutation testing answers "would these tests catch a broken implementation?", which is the real worry with agent-written tests. Coverage alone doesn't.
- The complexity limits keep functions small enough to review properly, for humans and for the review agents.

## Changing a gate
Lowering a threshold needs an ADR. No silent downgrades.
