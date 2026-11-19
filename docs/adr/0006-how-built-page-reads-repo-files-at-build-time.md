# ADR 0006: The how-built page reads repo files at build time

- **Status:** Accepted
- **Date:** 2026-11-19

## Context

The "How this was built" page shows the project's own records: `data/build-log.json`, `docs/adr/`, `docs/friction-log.md` and `docs/cost/ledger.csv`. CLAUDE.md says "server code is route handlers only", and the scope says there is no database and no server-side processing. The page still needs to read files on the server, because those files are not served to the browser and are not bundled by an import.

The content is our own, but it is still text written by agents and people, and two of the four sources are Markdown. Rendering Markdown is the classic route to injected HTML.

## Options considered

1. **A route handler that returns the data as JSON**, with a client page that fetches it. Fits the letter of the rule, but adds a request, a loading state and client JavaScript for content that never changes between deployments.
2. **A prebuild script that generates a JSON module.** Static, but a second source of truth to keep in sync and one more step that can be forgotten.
3. **A server component that reads the files at build time** (`readFileSync`, which Cache Components prerenders into the static shell). No runtime server code, no client JavaScript, no extra request.

For the Markdown: a dependency such as `react-markdown` (more complete, more audit surface), or a small parser in `src/lib/markdown` limited to the subset these docs use.

## Decision

Option 3, with the Markdown parsed by our own pure parser.

- `src/server/howbuilt-data.ts` is the only place that touches the file system. It reads four fixed repo paths (plus the contents of `docs/adr/`), never a path built from request data, and runs only during `next build`. At runtime the route is plain prerendered HTML.
- It is a narrow exception to "server code is route handlers only": build-time reads for one static page. It adds no runtime server code and no route handler.
- Every source is validated. An invalid `build-log.json`, an unreadable ADR, a friction log with no parseable entries (the heading format drifted) or a ledger with the wrong header **throws, which fails the build**. A half-rendered page never ships. Unreadable ledger rows are skipped and counted on the page instead, because one bad row should not hide the rest.
- The parser has no `html` node. Raw HTML in the source is kept as literal text, React renders text nodes only, and links are limited to `http(s):`, `#fragment` and relative paths, with anything containing whitespace, control characters or a backslash refused (browsers treat `/\host` as protocol-relative).

## Consequences

- The page is static (○ in the build output), adds nothing to the first-load JS for `/`, and works with JavaScript disabled.
- The page only updates when the site is rebuilt. That is right for a record of what was built, and Vercel rebuilds on every merge to `main`.
- We now own a small Markdown parser. It supports only the subset our docs use (no nested lists, blockquotes, images or footnotes) and is tested as a pure function, including property tests that it never throws and never emits an unsafe href. If the docs outgrow it, swap in a library behind the same `Block` types.
- Cost data is published: the page shows totals by branch and model and a session count, never session ids. Anything written into the four sources is public once merged, so it must be written with that in mind.
- `docs/threat-model.md` and `docs/runbook.md` are updated in the same change.
