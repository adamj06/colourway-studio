# ADR 0002: Client-side image processing

- **Status:** Accepted
- **Date:** 2026-11-15 (CORS spike result recorded 2026-11-15, feature 002)

## Context

Palette extraction and recolouring are pixel-heavy. Running them server-side on Vercel functions would cost execution time, add latency per change, and risk the free tier limits.

## Options considered

1. **Server-side (sharp in a route handler)**: one round trip per change, slow interactive recolouring, burns function time.
2. **Client-side canvas + Web Worker**: instant feedback, zero server cost, scales with users for free. Needs the image to be readable by canvas (CORS).

## Decision

Client-side. k-means palette extraction in CIELAB runs in a Web Worker, and recolouring is applied to canvas ImageData.

V&A images load **directly from `framemark.vam.ac.uk` in the browser**. There is no image proxy.

## Spike result (CORS)

`framemark.vam.ac.uk` IIIF images are served with `Access-Control-Allow-Origin: *`. So:

- Images are loaded with `<img crossOrigin="anonymous">`, **always**, including on the plain display images. A copy cached by the browser from a non-CORS request would otherwise be reused for a later CORS request and taint the canvas.
- The canvas stays untainted, so `getImageData` works. This is checked against the real server by the `@external` Playwright test (`tests/e2e/external-canvas.spec.ts`), which loads a framemark image from a different origin into a canvas and calls `getImageData`. It runs in the contract and smoke workflows, not in the PR e2e job.
- Only the JSON API goes through our route handlers (`/api/vam/*`, allowlisted to `api.vam.ac.uk`). Images never pass through Vercel, which saves function time and bandwidth.
- Sizes are requested from the IIIF server (`/full/!400,400/0/default.jpg` for thumbnails, `!1600,1600` for the design view), so the browser downloads only what it shows. A plain `<img>` is used, not `next/image`, because the IIIF server already resizes and Vercel image optimisation quota would be spent for nothing. `src/app/_components/DesignImage.tsx` is the only `<img>` in the app, and the only file with the `@next/next/no-img-element` lint rule turned off.

## Content-Security-Policy (final)

- `img-src 'self' blob: data: https://framemark.vam.ac.uk`. The framemark host is needed because images load directly. `blob:` and `data:` are for canvas export and previews.
- `connect-src 'self'`. This stays as it is **as long as images are loaded through `<img>` and never through `fetch` or `XMLHttpRequest`**. `<img>` loads are governed by `img-src`, and canvas `drawImage` of a CORS-enabled image needs no `connect-src` entry. If a later feature fetches image bytes with `fetch` (for example, to read a full-resolution file for export), `connect-src` must gain `https://framemark.vam.ac.uk` and this ADR must be updated.

## Consequences

- The colour maths lives in pure functions, which are easy to unit and mutation test.
- Large images are downscaled for analysis; full resolution is used only for export.
- If the V&A ever removes the CORS header, the `@external` test fails in the daily contract workflow. The fallback would be an allowlisted image proxy route with caching, and a new ADR.
