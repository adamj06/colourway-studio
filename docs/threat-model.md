# Threat model

A lightweight STRIDE pass, done at design time before any code, and kept current in PRs that change the architecture.

## What we're protecting
- **Availability** of a public demo.
- **Our infrastructure's reputation:** the proxy must not be usable to attack or scrape other sites.
- **The build pipeline:** secrets, the repo and deploy access, including from the coding agent itself.

There's no user data, no accounts and no payments, which removes most of the usual attack surface. That's deliberate.

## Trust boundaries
Browser → Next.js route handlers (Vercel) → V&A API / IIIF image server. Developer and agent → GitHub → Vercel.

| Threat | Where | Mitigation |
|---|---|---|
| **SSRF / open proxy** | `/api/vam/*` | Hard-coded host allowlist, no user-supplied URLs, redirects not followed blindly, response size and content-type limits |
| **XSS via upstream content** | V&A descriptions contain HTML | Rendered as text or sanitised; CSP blocks inline scripts; `dangerouslySetInnerHTML` needs review |
| **Tampered share links** | Colourway state in the query string | zod-validated with strict bounds (hex format, palette size); invalid state falls back to defaults |
| **Abuse / cost blow-out** | Proxy routes | Response caching and revalidation; Hobby plan can't incur charges (worst case: paused) |
| **Upstream outage or drift** | V&A API | Timeouts, retry, stale cache; daily contract check opens an issue on schema drift |
| **Supply chain** | npm and GitHub Actions | Lockfile with `npm ci`, Dependabot, `npm audit`, CodeQL, actions pinned to SHAs |
| **Secret leakage** | Repo and agent | gitleaks in CI; agent hooks block reading `.env`/keys; no `NEXT_PUBLIC_` secrets |
| **Agent misuse** (destructive or unreviewed actions) | Claude Code | Guard hook (force push, main, prod deploy, broad deletes) with tests; PR-only flow; branch protection; independent review agents |
| **Prompt injection via fetched content** | api-scout reading V&A responses | Content treated as data (CLAUDE.md rule); scout has no push or deploy capability; all changes go through PR review |
