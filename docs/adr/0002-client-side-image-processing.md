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

## Recolouring (feature 004)

- **Method.** Every pixel moves in CIELAB by a weighted blend of the swatches' shifts (target Lab minus source Lab), with weights proportional to 1/d^4 (d is the Lab distance to the swatch), normalised to sum to 1. Lightness detail is kept because only the blend of shifts is added to the pixel's own Lab. A pixel exactly on a swatch belongs to it alone.
- **Measured: the exact per-pixel path is too slow.** 766 to 1,053 ms per update on a 1600 px image (node, release JIT, 8 swatches). The target in the acceptance criteria was 150 ms, so a lookup table was added behind the same API.
- **Lookup table.** A pixel's new colour depends only on its own colour, so a table of the recolour at each node of a grid over sRGB is built per update and every pixel is then looked up with trilinear interpolation (`buildRecolourLut`, `applyLut` in `src/lib/colour/recolour.ts`). Each node's Lab value and weights depend only on the source palette, so they are computed once per palette (`createLutBuilder`).
- **Accuracy bound relaxed from deltaE2000 < 1 to <= 2.5 (decided by Adam, 2026-11-18).** The weights are steep next to a swatch colour (1/d^4) and near black, which a trilinear grid cannot follow closely. Against the exact path over a dense sweep (8 swatches, all changed): a 33^3 table reaches about 3.9; a 65^3 table meets 2.5; neither reaches 1, and neither did softening the weights. A deltaE2000 of about 2.5 is roughly the smallest difference the eye can see.
- **Two qualities.** While a colour is being dragged the page asks for a `preview` (33^3 table) and, once the targets have been unchanged for 250 ms, a `final` (65^3, within 2.5). Measured on 1600 x 1067 (node, 8 swatches, 5 runs): preview = 31 ms once per palette, then about 33 ms for the table plus 63 to 71 ms to apply = **about 100 ms per update** (target met). Final = 141 ms once per palette, then about 243 ms for the table plus 90 to 102 ms to apply = **about 330 to 345 ms once, on settle** (target not met, by design: it is not on the drag path). The conversion to sRGB of 274,000 nodes dominates the final table.
- **Typed-array loop.** The per-pixel loop indexes typed arrays directly instead of going through the shared `at()` helper, which several kinds of typed array made megamorphic: that change alone took applying the table from about 1,040 ms to about 115 ms.
- **Same worker pattern as palette extraction.** A lazily created module worker (only once a colour is first changed, so first-load JS is unchanged), zod validation both ways, ids with latest-wins (a superseded request posts nothing; the page also ignores any answer whose id is not the newest), the image already on screen shrunk to at most 1600 px and transferred (bitmap through an `OffscreenCanvas`, or an RGBA buffer), results transferred back. No second download, so `connect-src` stays `'self'`.

## Consequences

- The colour maths lives in pure functions, which are easy to unit and mutation test.
- Large images are downscaled for analysis; full resolution is used only for export.
- If the V&A ever removes the CORS header, the `@external` test fails in the daily contract workflow. The fallback would be an allowlisted image proxy route with caching, and a new ADR.

- **Top-up (issue #19).** Merging near-duplicate clusters used to leave fewer swatches than the k picked. Extraction now re-runs k-means with one more cluster (up to 2k) until k distinct swatches remain, then keeps the k largest. Most images need no extra run; each extra run costs about one k-means run at the larger k. Timed on 40,000 synthetic samples (node): 260 to 270 ms at k=4 and 443 to 451 ms at k=8 including any top-up; the worst case is bounded by the 2k cap and, as before, is abandoned between iterations when superseded.
