# ADR 0002: Client-side image processing

- **Status:** Accepted (pending the CORS spike)
- **Date:** 2026-11-15

## Context
Palette extraction and recolouring are pixel-heavy. Running them server-side on Vercel functions would cost execution time, add latency per change, and risk the free tier limits.

## Options considered
1. **Server-side (sharp in a route handler)**: one round trip per change, slow interactive recolouring, burns function time.
2. **Client-side canvas + Web Worker**: instant feedback, zero server cost, scales with users for free. Needs the image to be readable by canvas (CORS).

## Decision
Client-side. k-means palette extraction in CIELAB runs in a Web Worker, and recolouring is applied to canvas ImageData.

## Consequences
- Needs `Access-Control-Allow-Origin` on images from framemark.vam.ac.uk. If that header is missing, images are served through our own proxy route with caching (spike 1 decides).
- The colour maths lives in pure functions, which are easy to unit and mutation test.
- Large images are downscaled for analysis; full resolution is used only for export.
