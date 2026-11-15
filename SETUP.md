# Colourway Studio: starter kit setup

## 1. Repo and scaffold (about 10 minutes)

```powershell
npx create-next-app@latest colourway-studio --ts --eslint --app --src-dir --tailwind --import-alias "@/*"
cd colourway-studio
```

Copy everything from this kit into the repo root (`.claude/`, `.github/`, `docs/`, `data/`, `CLAUDE.md`), then:

```powershell
# Make sure secrets never get committed
Add-Content .gitignore "`n.env*`n!.env.example`n.vercel`nreports/`n"
git add -A; git commit -m "chore: guardrails, agents and CI before any app code"
gh repo create colourway-studio --public --source . --push
```

Committing the kit as the very first commit is deliberate: the git history shows guardrails came first.

## 2. Wire up the services

- **Vercel**: import the GitHub repo (Hobby plan). Previews deploy per PR and production deploys on merge to main. No local `vercel --prod` (the hooks block it).
- **Branch protection** on `main`: require PRs and the `checks` job.
- **Claude PR review**: run `claude setup-token` and add the result as the `CLAUDE_CODE_OAUTH_TOKEN` repo secret.
- **pricing.json**: fill in per-token prices from Anthropic's pricing page. The ledger estimates and the USD budget limits only work once these are set (the token limits work regardless).
- **budget.json**: set daily soft and hard limits you're comfortable with.
- **Provider-side cap**: if you use an API key, also set a spend limit on the workspace in the Anthropic Console. The local hooks are the seatbelt; the provider cap is the brakes.
- **Vercel**: the Hobby plan has no billing, so the worst case is the site pausing, never a bill. Worth saying out loud in the interview.

## 3. First session prompts

Start `claude` in the repo, then go through these in order:

**Prompt 1: tooling setup (Sonnet is fine)**
> Read CLAUDE.md and docs/quality-gates.md. Set up the tooling so every gate in the table is actually enforced: Vitest with the coverage thresholds, Playwright with @axe-core/playwright, StrykerJS (scoped to src/lib/colour, break threshold 80), typescript-eslint strict-type-checked plus jsx-a11y and the complexity rules, the tsconfig strict flags, size-limit, husky + lint-staged + commitlint (the config files already exist), zod, Prettier, and the npm scripts named in CLAUDE.md. Add security headers in next.config. No app features yet. Prove each gate works by briefly breaking it and showing it fail. Use /feature 001-tooling.

That "prove each gate fails" step is worth screenshotting for the presentation.

**Prompt 1b: production plumbing (same branch or the next one)**
> Following the Production standards in CLAUDE.md: add src/env.ts (zod), the structured logger, root error.tsx and not-found.tsx, GET /api/health (commit SHA + V&A reachability), a test:contract script, and a @smoke-tagged Playwright test that honours BASE_URL and sends the x-vercel-protection-bypass header when VERCEL_AUTOMATION_BYPASS_SECRET is set. Pin every GitHub Action in .github/workflows to a full commit SHA with the version as a comment. Use /feature 001b-platform.

**Prompt 2: the CORS spike (this decides ADR 0002)**
> Use the api-scout subagent: find 3 William Morris wallpaper or textile objects with images via the V&A v2 API, save fixtures, and check whether framemark.vam.ac.uk image responses include Access-Control-Allow-Origin. Report back before we build anything.

**Prompt 3 onwards: features, one per /feature run, with /clear in between**
- `/feature 002-vam-browse Search and browse Morris designs via a cached proxy route`
- `/feature 003-palette Extract a 4 to 8 colour palette in CIELAB using k-means in a Web Worker`
- `/feature 004-recolour Recolour by palette swatch, preserving luminance texture`
- `/feature 005-share-export Colourway state in the URL plus PNG export`
- `/feature 006-wall-preview Tiled repeat on a wall mock`
- `/feature 007-how-built How this was built page from the build log, ADRs, friction log and ledger`

## 4. Habits that make the interview story

- `/friction <what happened>` every time something goes sideways. Don't save them up for later.
- Use plan mode (Shift+Tab) for anything non-trivial. `opusplan` automatically uses Opus while planning.
- Before the interview, run `npx ccusage` and compare it with `docs/cost/ledger.csv`.
