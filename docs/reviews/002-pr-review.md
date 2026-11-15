## Review (against CLAUDE.md)

I read the V&A proxy, the client, fetch-with-retry, the mappers, the guards, the route handlers, the cache layer and the UI that renders V&A data. The proxy and the XSS handling look sound, and I found nothing that blocks merge.

**SSRF and validation:** Upstream hosts are hard-coded (`client.ts:7`). Ids must match `^O\d{1,10}$` at the route (`params.ts:12`), in the client (`client.ts:47`) and in the mappers. `q` only ever goes in via `searchParams.set`, and the tests pin the injection and traversal cases. Redirects are `manual` (`fetch-with-retry.ts:65`, asserted in `hardening.test.ts:33`). The body is size-capped, must be JSON, and sits inside the 5s timeout.

**XSS:** There is no `dangerouslySetInnerHTML`. `htmlToText` strips tags before it decodes entities, so encoded tags stay text. `<img src>` only accepts the exact framemark IIIF shape (`iiif.ts:3`). `collectionUrl` is limited to https on `collections.vam.ac.uk`.

### Must fix

None.

### Should fix

1. **Stale data is not served on upstream failure (`src/server/vam-cache.ts:19-37`).** CLAUDE.md says to "serve stale cached data rather than an error where possible", and `docs/runbook.md:37,56` claims cached pages keep working during an outage. As written, `cachedSearch` and `cachedDesign` return an error `Outcome` and cache it (`stale 5, revalidate 10, expire 60`). So when a `hours` entry revalidates during an outage, the failure outcome seems to replace the good entry, and users get a 502 for something we held a minute ago. I believe this is the case, but I haven't run it against a real `use cache`.
   - The fix could be to keep the last good value, or to throw on failure so the previous entry survives. If neither is feasible, correct the runbook and threat-model wording.
2. **Tests can't catch (1) (`src/server/vam-cache.test.ts:5-51`).** `next/cache` is mocked, so the tests only check that `cacheLife` was called with the right profile. They never check what happens to an already-cached good value when the next fetch fails. Add a test or an e2e case for "good, then upstream 5xx, then still the good value", or document that this isn't covered.
3. **Unbounded cache keys and V&A calls on `/api/vam/search` (`params.ts:6-11`, `vam-cache.ts:25`).** Every distinct `q` (up to 100 characters) × page (up to 100) is a separate cache entry and a separate V&A call. The CDN doesn't help with unique strings. Nothing throttles this, so anyone can drive uncached traffic at the V&A from our User-Agent. Consider a lower `MAX_PAGE`, normalising `q` (lowercase, collapse whitespace) before it becomes a cache key, and noting the residual risk in `docs/threat-model.md`.

The commit trailers (`Claude-Model`, `Feature`), the `process.env` ban and the logging rules (the only `console.log` is in the exempt `src/lib/log`) all look compliant. I didn't run lint, typecheck, tests or e2e. I only read the code.
