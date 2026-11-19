# ADR 0005: The colourway URL carries the full palette

- **Status:** Accepted
- **Date:** 2026-11-19

## Context

A colourway has to live in the URL query string (no accounts, no database), so a link reproduces it exactly. A link is a public contract: once one is shared, the format has to keep working. Two things make "exactly" hard:

- The palette is extracted in the browser from a downscaled canvas. Downscaling and colour handling differ a little between browsers, so re-running extraction from a link could give slightly different swatches than the sharer saw.
- Edits are stored against swatch positions, and a palette can merge to fewer than the requested `k`.

## Options considered

1. **`k` + edits by index** (`?k=6&e=2:C04030`). Shortest, but it relies on extraction giving the same swatches on every browser. Exact in one browser, possibly drifting across browsers.
2. **`k` + original to new colour pairs**, matched to the nearest extracted swatch on load. Robust, but approximate, and it needs a matching threshold.
3. **The full palette: every original swatch plus its edit** (`?cw=1F3A2B.C04030~E0D0A0`). A little longer (at most 111 characters for 8 edited swatches). Exact on any browser, because the link's own palette is used and extraction does not run.

## Decision

Option 3. `cw` is a dot-separated list of 1 to 8 swatches, each `RRGGBB` or `RRGGBB~RRGGBB` (original, then edit): no `#`, upper case on output, lower case accepted on input, at most 128 characters. Decoding is strict and never throws; anything unreadable is ignored with a polite message and the normal palette is shown. An edit equal to its original is dropped, the same rule as the reducer. With no edits there is no `cw` at all. Changing `k` discards the edits and removes `cw`, because the swatches they pointed at no longer exist.

The link carries no per-swatch share ("18% of the design"), so a palette opened from a link has its shares computed from the image: each sampled pixel is counted against its nearest swatch in CIELAB (`swatchShares`), in the palette worker. No k-means runs.

Validation is one zod schema for the whole grammar (CLAUDE.md: zod at every boundary), so the decoder cannot accept anything the schema does not. The design page already ships zod through the palette worker protocol, and none of this is in the first-load JS for `/`.

## Consequences

- A shared link reproduces the same swatches and edits in any browser. The recoloured pixels can still differ very slightly, because the image is decoded by the viewer's own browser.
- The format is now a contract. Changes need a new parameter name or a version marker, not a silent change to `cw`.
- A link opened later reflects the current V&A image for that object. If the museum replaces the image, an old link recolours the new one.
- Duplicate swatch colours are valid in a link but behave like one swatch: shares and recolouring go to the lowest index, so an edit on a later duplicate has no visible effect. Extraction rarely produces exact duplicates, so this is documented, not rejected.
- A link with fewer than 4 swatches (a palette that merged down) opens fine; the colours control then shows its nearest setting.
- Opening a link costs one share computation (about one pass over at most 40,000 samples) instead of a k-means run.
