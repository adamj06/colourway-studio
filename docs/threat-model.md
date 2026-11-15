# Threat model

A lightweight STRIDE pass, done at design time before any code, and kept current in PRs that change the architecture.

## What we're protecting

- **Availability** of a public demo.
- **Our infrastructure's reputation:** the proxy must not be usable to attack or scrape other sites.
- **The build pipeline:** secrets, the repo and deploy access, including from the coding agent itself.

There's no user data, no accounts and no payments, which removes most of the usual attack surface. That's deliberate.

## Trust boundaries

Browser → Next.js route handlers (Vercel) → V&A API / IIIF image server. Developer and agent → GitHub → Vercel.

| Threat                                               | Where                               | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SSRF / open proxy**                                | `/api/vam/*`                        | Hard-coded host allowlist, no user-supplied URLs, redirects not followed blindly, response size and content-type limits                                                                                                                                                                                                                                                                                                                                                    |
| **XSS via upstream content**                         | V&A descriptions contain HTML       | Rendered as text or sanitised (the primary defence); `dangerouslySetInnerHTML` needs review. The CSP is defence in depth only: `script-src` allows `'unsafe-inline'` because Next needs inline bootstrap scripts without nonces (ADR 0003), so it does **not** stop an injected inline script. It does restrict script, connect, font and frame sources, `object-src 'none'`, `base-uri` and `form-action`                                                                 |
| **Tampered share links**                             | Colourway state in the query string | zod-validated with strict bounds (hex format, palette size); invalid state falls back to defaults                                                                                                                                                                                                                                                                                                                                                                          |
| **Abuse / cost blow-out**                            | Proxy routes                        | Response caching and revalidation; Hobby plan can't incur charges (worst case: paused)                                                                                                                                                                                                                                                                                                                                                                                     |
| **Upstream outage or drift**                         | V&A API                             | Timeouts, retry, stale cache; a daily contract workflow is wired to open an issue on schema drift, but **it is planned, not active**: there are no contract tests yet (`passWithNoTests`), so the job passes without checking anything until feature 002 adds them                                                                                                                                                                                                         |
| **Supply chain**                                     | npm and GitHub Actions              | Lockfile with `npm ci`, Dependabot, `npm audit`, CodeQL, the two actions that receive tokens (`gitleaks-action`, `claude-code-action`) are pinned to commit SHAs; every other action is on a major version tag, updated by Dependabot (a known, accepted gap). `semgrep` is installed unpinned via pipx                                                                                                                                                                    |
| **Secret leakage**                                   | Repo and agent                      | gitleaks in CI; agent hooks block reading `.env`/keys; no `NEXT_PUBLIC_` secrets                                                                                                                                                                                                                                                                                                                                                                                           |
| **Agent misuse** (destructive or unreviewed actions) | Claude Code                         | Guard hook (force push, main, prod deploy, broad deletes, hook-skipping, shell writes to guardrail files) with tests; the hook itself returns an `ask` decision for Edit/Write/MultiEdit of guardrail files, backed by `ask` rules in settings; PR-only flow; branch protection; independent review agents. **The regex guard is a tripwire; the real controls are the hook's ask decision on Edit/Write, branch protection and review.** See "Guardrail protection" below |
| **Prompt injection via fetched content**             | api-scout reading V&A responses     | Content treated as data (CLAUDE.md rule); scout has no push or deploy capability; all changes go through PR review                                                                                                                                                                                                                                                                                                                                                         |

## Security headers (set in `next.config.ts` from `src/config/security-headers.ts`)

- **Every environment:** Content-Security-Policy, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone, geolocation off), `X-Frame-Options: DENY` plus CSP `frame-ancestors 'none'`, `Cross-Origin-Opener-Policy: same-origin`. `X-Powered-By` is removed.
- **Production deploys only** (`VERCEL_ENV === 'production'`): `Strict-Transport-Security` (2 years, includeSubDomains) and the CSP `upgrade-insecure-requests` directive. Local `next start` and preview deploys don't get them, so http://localhost keeps working.
- **Dev only:** `'unsafe-eval'` in `script-src` (React dev tooling). `NODE_ENV` defaults to `production` when unset (`src/env.ts`), so a missing value fails closed, and the e2e headers test asserts `unsafe-eval` is absent.
- **`worker-src 'self'`** is set explicitly (ADR 0003): only bundled same-origin workers, no `blob:` workers. A blob worker would need an ADR.
- Headers are computed at **build time** from `VERCEL_ENV`. A preview build promoted to production would lack HSTS, so roll back only to previous _production_ deployments (runbook). HSTS includes `includeSubDomains` for two years: reconsider before attaching a custom apex domain that hosts other subdomains.
- `img-src` also allows `blob:` and `data:` (canvas export and previews).
- `img-src` allows `https://framemark.vam.ac.uk` until the CORS spike decides how images load (see the TODO in ADR 0002). This is the only external host in the policy.

## Smoke-test credentials

- `VERCEL_AUTOMATION_BYPASS_SECRET` is sent **once**, by `tests/e2e/fixtures.ts`, in a Node-side request (redirects off) to the deployment's own URL, to obtain Vercel's host-only bypass cookie. The page never sends the header itself, so it cannot reach a third party (for example framemark.vam.ac.uk) or follow a redirect with it. `tests/e2e/bypass-secret.spec.ts` asserts that no request the page makes carries it.
- The fixture refuses to send the secret unless `BASE_URL` is https on `*.vercel.app` or a host in `BYPASS_ALLOWED_HOSTS` (`tests/e2e/trusted-origin.ts`, unit tested).
- Tracing is off whenever the secret is set, because traces record request headers. The CI `e2e` job uploads its report and never receives the secret; only `smoke.yml` does, and it uploads nothing.
- **Residual risk:** `smoke.yml` runs the PR's own tests and preview build with the secret (same-repo branches), so anyone who can push a branch could read it. Acceptable for a one-person project. A GitHub Environment with required reviewers is the fix once there is a team (docs/production-readiness.md). The secret is project-wide, so rotate it (runbook) if it may have leaked.

## Guardrail protection

What protects the agent's own guardrails, strongest first:

1. **The hook's `ask` decision** (`.claude/hooks/guard.mjs`): Edit, Write and MultiEdit on guardrail files return `permissionDecision: "ask"`, in every permission mode that honours hook decisions. The `ask` rules in `.claude/settings.json` back it up.
2. **Branch protection and review:** every change reaches `main` through a PR that Adam reviews, after the independent review agents have run.
3. **The regex guard over shell commands:** a tripwire, not a sandbox.

> The regex guard is a tripwire; the real controls are the hook's ask decision on Edit/Write, branch protection and review.

Guardrail files: `.claude/settings*.json`, `.claude/budget.json`, `.claude/hooks/**` (including `pricing.json`), `.claude/agents/**`, `.claude/commands/**`, `CLAUDE.md`, `AGENTS.md`, the quality-gate configs (`vitest.config.ts`, `stryker.config.mjs`, `.size-limit.mjs`, `eslint.config.mjs`, `lint-staged.config.mjs`, `commitlint.config.mjs`), `.husky/**` and `.github/workflows/**`.

The shell guard blocks: redirects into those files; `rm`, `mv`, `tee`, `touch` and `truncate` at command position; `sed -i` and `perl -i`; `cp`, `mv` and `install` into them (including `-t DIR`); `prettier --write` and `eslint --fix` on them; `git restore/checkout/stash/clean/rm/mv` on them or on the bare `.claude` folder; and hook skipping (`--no-verify`, `git commit -n`, disabling husky, overriding the git hooks path).

**Known gaps (what it does not cover):**

- `cd .claude/hooks && sed -i ... guard.mjs`: a `cd` in an earlier segment hides the target from the per-segment check.
- `dd of=...`, and any other write tool or option the regexes don't list.
- `git apply` and `git am` with a patch whose contents touch guardrail files (the command line names no path).
- Scripts, interpreters and package scripts that write the files indirectly (`node script.js`, `npm run something`), and commands built from variables or encoded strings. Only literal write calls in the command text are caught, and the check can also fire on text that merely mentions a guardrail file next to a write call.
- Anything run outside the Bash tool, and any session in a permission mode that skips hooks.

Tests pin the known gaps (`KNOWN GAP` in `.claude/hooks/tests/guard.test.mjs`) so nobody mistakes the guard for a sandbox. The spend limits in `budget.json` are guardrails too, but the daily USD figure also reads `docs/cost/ledger.csv`, which is not protected.
