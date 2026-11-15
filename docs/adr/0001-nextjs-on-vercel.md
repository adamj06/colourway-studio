# ADR 0001: Next.js on Vercel

- **Status:** Accepted
- **Date:** 2026-11-15

## Context
The brief asks for a running application that costs nothing, and the panel should be able to try it themselves. The interviewing team is a .NET/Python shop.

## Options considered
1. **ASP.NET Core + Blazor in a container** (Azure free tier or similar): matches their stack, but it needs container hosting and has cold starts, and a free tier with a public URL is fiddly to get.
2. **Next.js on Vercel (Hobby)**: free for personal, non-commercial use, preview deploy per PR, production on merge to main, and a shareable URL with no setup.
3. **Static SPA on GitHub Pages**: free and simple, but no server side to proxy and cache the V&A API.

## Decision
Next.js (App Router, TypeScript strict) on Vercel. The engineering method being demonstrated doesn't depend on the stack.

## Consequences
- The panel gets a link they can open on any device.
- Per-PR previews make "repo to running app" visible in the PR history.
- Not their stack. Mitigated by keeping the colour logic as pure TypeScript functions that would port to C# directly.
