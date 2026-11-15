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

## Palette extraction (feature 003)

- **Pixels without a second download.** The design view's already loaded `<img>` is shrunk with `createImageBitmap(img, { resizeWidth, resizeHeight })` to at most 600 px on the longest side and the bitmap is **transferred** to the worker, which reads it through an `OffscreenCanvas`. If `createImageBitmap` or `OffscreenCanvas` is missing (or rejects), the page draws to a small canvas and transfers the RGBA buffer instead. Both paths use the image that is already on screen, so `connect-src` stays `'self'`.
- **Same result as `!600,600`.** Analysing the downscaled display image gives the same palette a separate `!600,600` request would, without a second request.
- **Lazy loading.** The worker is created with `new Worker(new URL(...), { type: 'module' })` only on the design page and only after the image has loaded, so no colour code is in the first-load JS for `/`.
- **Cancellation.** Every request carries an id and the worker keeps only the latest: a request superseded before or during its run is abandoned and posts nothing; the page also ignores any answer whose id is not the newest. This is real mid-run cancellation: k-means runs one iteration per step (`kmeansLabSteps`), the handler yields to the event loop between steps (a `MessageChannel` task, not `setTimeout(0)`, which added about 25% overhead through timer clamping) and `shouldStop` then abandons the run at the start of its next iteration. It is needed because runs are not short: measured in node on three real 600 px designs (about 36,000 to 40,000 samples, 10 timed runs each after a warm-up), the median k-means time is 202 to 365 ms at k=4, 489 to 550 ms at k=6 and 671 to 719 ms at k=8, with a worst run of 755 ms; sampling is only about 20 ms of that. A k=4 pick made 50 ms into a k=8 run is answered after about 350 ms, which is roughly the k=4 run's own time, instead of waiting out the k=8 run first. The worker caches the sampled Lab values per image, so changing k never resends pixels.
- **Colour conversion constants.** RGB to XYZ uses the sRGB matrix to the 4 decimals the standard publishes, with the CIE D65 white. A 7-digit matrix would differ from the independent oracle by up to 0.022 Lab; details in `tests/fixtures/colour/README.md`.

## Consequences

- The colour maths lives in pure functions, which are easy to unit and mutation test.
- Large images are downscaled for analysis; full resolution is used only for export.
- If the V&A ever removes the CORS header, the `@external` test fails in the daily contract workflow. The fallback would be an allowlisted image proxy route with caching, and a new ADR.
