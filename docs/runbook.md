# Runbook

## Stand it up from scratch (target: under 15 minutes)

Prerequisites: Node 22, a GitHub account, a Vercel account (Hobby).

1. `gh repo fork <owner>/colourway-studio --clone && cd colourway-studio`
2. `npm ci && npm run dev`, then open http://localhost:3000. No environment variables are required.
3. Vercel: **Add New Project** → import the repo → Deploy. The defaults work.
4. GitHub: protect `main` (require PRs and the `checks` job). Optional secrets: `CLAUDE_CODE_OAUTH_TOKEN` (PR review), `VERCEL_AUTOMATION_BYPASS_SECRET` (smoke tests on protected previews).
5. Verify: `/api/health` returns 200 and the smoke workflow passes on the first deployment.

## Deploy

Merge a PR to `main`. Vercel builds and promotes it; the smoke workflow runs against the production URL.

## Roll back

Vercel dashboard → Deployments → previous production deployment → **Promote to Production** (instant, no rebuild). Then revert the offending PR on `main` so the next deploy doesn't reintroduce it.

## Incidents

| Symptom                                | Likely cause                 | Action                                                                                         |
| -------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| Search returns errors or empty results | V&A API down or slow         | Check `/api/health`. Cached pages keep working. Nothing to fix our side; wait it out           |
| Images won't load or recolour          | IIIF server or CORS change   | Check the browser console for CORS errors; check the image proxy route                         |
| Contract-drift issue opened            | V&A changed a response shape | Capture a new fixture with api-scout, update the zod schema and mappers, add a regression test |
| Site paused                            | Hobby usage limits           | Check Vercel usage; review cache headers on the proxy routes                                   |

## Quality commands

| Command                                                       | What it checks                                                                           |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `npm run lint` / `npm run format:check` / `npm run typecheck` | ESLint (zero warnings), Prettier, `tsc --noEmit`                                         |
| `npm run test -- --coverage`                                  | Vitest with the coverage thresholds from docs/quality-gates.md                           |
| `npm run test:e2e`                                            | Playwright + axe against a production build (set `BASE_URL` to target a live deployment) |
| `npm run test:mutation`                                       | Stryker on `src/lib/colour` (skips cleanly while that folder has no code)                |
| `npm run build && npm run size`                               | size-limit bundle budget (build first)                                                   |
| `npm run test:contract`                                       | Live V&A responses against the zod schemas                                               |
