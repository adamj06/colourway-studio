# Production readiness: what's in, and what's deliberately out

This is a small public demo. The bar is "production-quality engineering, proportionate to the problem". Everything below is a conscious decision, not an oversight.

## In

Strict types, enforced quality gates (coverage, mutation score, complexity, a11y, bundle size), tests at three levels plus smoke tests on every live deployment, a daily contract workflow for the real API (wired up, but the contract tests themselves are planned for feature 002 and the job passes vacuously until then), security scanning (gitleaks, Semgrep, CodeQL, npm audit, Dependabot), a design-time threat model, upstream resilience (timeouts, retry, stale cache), structured logging, a health endpoint, a runbook with rollback, and an agent workflow with tested guardrails and independent review.

## Deliberately out, and what would trigger adding it

| Not built                                                    | Why not now                                                                                                                                | Would add when                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Smoke secret in a GitHub Environment with required reviewers | One developer. Smoke runs a PR's own tests with the bypass secret, which is acceptable only while every branch is Adam's                   | Would add with a team (anyone else can push branches)        |
| SHA-pinning every GitHub Action                              | Only the two actions that hold long-lived secrets (gitleaks, claude-code-action) are pinned; the rest are major tags managed by Dependabot | Would add with a team, or if any action's maintainer changes |
| Auth / accounts                                              | No user data; saved colourways live in the URL                                                                                             | Users need to save private collections                       |
| Database                                                     | Stateless by design                                                                                                                        | Saved collections, analytics on popular colourways           |
| Error tracking (e.g. Sentry)                                 | Vercel logs plus structured logging suffice at demo traffic                                                                                | Real users, or any error budget worth tracking               |
| Rate limiting (e.g. Upstash)                                 | Caching plus no-bill hosting caps the blast radius                                                                                         | Paid hosting, or abuse seen in logs                          |
| Infrastructure as code                                       | One Vercel project with defaults; the runbook stands it up in minutes                                                                      | Multiple environments or team ownership                      |
| Feature flags                                                | Single developer, PR previews cover "try before release"                                                                                   | Multiple teams or gradual rollouts                           |
| Load testing                                                 | Static plus cached proxy; Vercel's edge handles the load                                                                                   | Before a marketing launch                                    |
| Visual regression snapshots                                  | Canvas output varies across GPUs; the colour maths is unit and mutation tested instead                                                     | A design system shared across apps                           |
| i18n                                                         | English-only demo audience                                                                                                                 | Customer-facing launch outside the UK                        |

## If SDG used this for real

- Swap V&A imagery for SDG's own archive, using **separated colour layers** so recolouring is exact rather than estimated.
- Add SSO for internal users and an audit trail of generated colourways.
- Pick the hosting that fits the existing estate. The colour logic is pure TypeScript and ports directly to .NET.
