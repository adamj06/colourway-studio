# ADR 0003: Static CSP with 'unsafe-inline' instead of nonces

- **Status:** Accepted
- **Date:** 2026-11-15

## Context

We want a Content-Security-Policy on every response. Next.js injects inline bootstrap scripts, so a policy needs either `'unsafe-inline'` or per-request nonces. Nonces require a `proxy.ts` that sets the header per request, and the Next 16 docs state that a nonce only works on **dynamically rendered** pages: static pages are built before any request exists. The app is otherwise static and cached, and must stay free to run on Vercel Hobby.

## Options considered

1. **Nonce-based CSP via `proxy.ts`:** strict `script-src` (`'nonce-…' 'strict-dynamic'`). Forces every page to render dynamically, which loses static caching and costs function time on every request.
2. **Hash-based CSP via experimental SRI:** keeps static rendering and a strict policy, but the feature is experimental in this Next version.
3. **Static CSP in `next.config.ts` with `'unsafe-inline'`:** the approach documented for apps that don't need nonces. Pages stay static and cached.

## Decision

Option 3. `src/config/security-headers.ts` builds the headers and `next.config.ts` applies them to every route. `script-src` is `'self' 'unsafe-inline'` (plus `'unsafe-eval'` in development only). HSTS and `upgrade-insecure-requests` are sent only when `VERCEL_ENV === 'production'`.

### worker-src

`worker-src 'self'` is set explicitly. Without it, workers fall back to `child-src`, then `script-src`, so a policy edit elsewhere could silently change what workers may load. The palette worker (`src/workers/`, bundled with `new Worker(new URL(...))`) is same-origin, so `'self'` is enough. `blob:` workers stay blocked on purpose: allowing them would let any injected script spawn a worker from a string. If a feature ever needs a blob worker, that is a new decision and needs an ADR.

## Consequences

- The CSP is **defence in depth, not an XSS barrier**: it does not stop an injected inline script. Our primary XSS defence is rendering V&A text as text (docs/threat-model.md). It still restricts script, connect, font and frame sources and sets `object-src 'none'`, `base-uri`, `form-action` and `frame-ancestors 'none'`.
- Pages stay static, so there is no per-request cost.
- Revisit if SRI hash-based CSP becomes stable, or if the app gains pages that render user-controlled HTML.
- `img-src` includes `https://framemark.vam.ac.uk` until the CORS spike decides how images load (see the TODO in ADR 0002).
