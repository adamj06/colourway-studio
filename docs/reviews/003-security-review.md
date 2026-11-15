# Security review: feature 003-palette

- **Reviewer:** `security-reviewer` subagent (read-only), re-run on 2026-11-15 against branch `feat/003-palette` including the uncommitted working tree. The first run's report was lost when the budget guard blocked its delivery; a second copy of that run was resent in full and agrees with this one (no Critical or High, two Mediums, the same Lows).
- **Saved:** the findings below are the reviewer's report. Only the formatting is changed. The "Disposition" section at the end is the author's.

## Findings

**Critical:** checked, nothing found.

**High:** checked, nothing found.

### Medium

1. **The raw Sharma file's hash is never checked by a test.** Fixture integrity is claimed but not enforced.
   - Where: `tests/fixtures/colour/README.md` (SHA-256 `44aebb39...a4b8`), `scripts/convert-sharma.mjs:40`, `tests/helpers/colour.ts:22`.
   - The hash appears only in the README prose and is written into `sharma-2005.json` as `rawSha256`. No test or script recomputes it. A grep of `tests/`, `src/` and `scripts/` for `sha256` and `createHash` matched only `convert-sharma.mjs`.
   - The test that "re-parses the raw file" compares the .txt with the JSON. A tampered .txt that was regenerated into the JSON, or both edited together, passes. This is the oracle for CIEDE2000, so a silent change would make a wrong implementation look correct.
   - Fix: a Vitest test that reads `ciede2000testdata.txt` as bytes and asserts its SHA-256 equals a hard-coded constant (the README value), and that `sharma-2005.json`'s `source.rawSha256` equals that constant. Do the same for the `colour-science` output, for example by pinning `source.version`.
   - Also check `.gitattributes`. If autocrlf or eol normalisation applies to `*.txt`, the byte hash can differ between Windows and CI. Mark the fixture `-text` or `binary`.

2. **The venv from the documented regeneration command is not git-ignored.**
   - Where: `.gitignore`, `scripts/gen-lab-reference.py:8-9`, `tests/fixtures/colour/README.md`.
   - `git check-ignore -v .venv-colour/x` returned nothing. The ignore files have no `venv` or `__pycache__` entry.
   - Scenario: following the README creates `.venv-colour/`, and `git add -A` or lint-staged commits thousands of third-party files. `prettier --check .` and eslint also walk it unless it is in `.prettierignore` and the eslint ignores, which would break `verify:clean`.
   - Fix: add `.venv*/`, `__pycache__/` and `*.pyc` to `.gitignore`. Add `.venv*` to `.prettierignore` and the eslint `globalIgnores`, and to the Stryker and Vitest excludes if those use broad globs.

3. **The docs have a gap and a stale claim about the dependencies.**
   - Where: `docs/threat-model.md:25` (supply chain row), `docs/runbook.md`.
   - The supply-chain row does not mention `fast-check` or the optional pip-installed `colour-science` (pinned with `==0.4.7`, which is good). It also does not say the script runs only on a developer machine and never in CI.
   - The pip install has no hash pinning (`--require-hashes`), and the transitive dependencies (numpy, scipy and others) are unpinned. The risk is a developer-machine compromise via PyPI. It is low, but the model should record it.
   - Fix: add one sentence to the supply-chain row covering the dev-only `fast-check`, the manual Python oracle script, and that the generated JSON is reviewed in PRs. Optionally pin the transitive dependencies with a hashed `requirements.txt`.
   - `docs/runbook.md` does not say that `npm audit` shows dev-only moderates (see the audit section). Either add a line or fix them.

### Low

4. **The worker's ImageBitmap path is bounded, but the bound is applied after the bitmap exists.**
   - Where: `src/workers/palette.worker.ts:21-28`.
   - A same-origin sender is trusted and the only sender is the page, so this is not exploitable. `readPixels` rejects sides above 1024 before it creates the OffscreenCanvas, so the worst case is 1024×1024×4 = 4 MB. The k range (4 to 8) is validated in `bitmapRequest`. The pixel path is bounded by the zod `refine` (`data.length === w*h*4`) before any allocation. The sampling cap (40,000) and iteration cap (20) bound the CPU cost.
   - Nit 1: `z.instanceof(ImageBitmap)` evaluates `ImageBitmap` at module load. That is fine in a worker, but the module throws a ReferenceError in an environment without it, such as old browsers or node tests. `palette.worker.ts` is not imported by the unit tests, so this is acceptable. A guarded check would be more robust.
   - Nit 2: when a message with an invalid `k` fails `bitmapRequest`, it falls through to `handler.handle`. That rejects it with an error, but the bitmap is never `close()`d and is left to GC. Fix: in the `else` branch, close any `event.data.bitmap` that is an `ImageBitmap`.
   - A posted `analyse-bitmap` also does not supersede earlier work the way `handler.handle` takes a ticket. The `latest` ticket is taken only inside the handler after the bitmap is read, so a quick succession of bitmaps does redundant work. That is bounded and harmless.

5. **Leaks on error paths in `paletteClient.ts` and `paletteImage.ts`.**
   - Where: `src/app/_components/paletteClient.ts:66-75`, `src/app/_components/paletteImage.ts:46-50`.
   - If `worker.postMessage` throws (a DataCloneError) after a bitmap is created, `.catch(fail)` runs and the bitmap is not closed.
   - `fail()` does not terminate the worker. Only `dispose()` does. If `fail()` runs and the component stays mounted, the worker idles until unmount or retry. Retry bumps `attempt` and the effect cleanup disposes the worker, so this is correct.
   - Fix: wrap `postSnapshot` in try/finally that closes the bitmap on failure, and call `worker.terminate()` in `fail()`.
   - Positive: `dispose()` terminates the worker, the late-snapshot case closes the bitmap, and the worker closes the bitmap in `finally`. Transfer rather than copy is used on both paths.

6. **No `onmessageerror` handling gap, and `usePalette` has no retry loop limit.**
   - Where: `src/app/_components/usePalette.ts`.
   - Retry is user-triggered, so there is no automatic loop, and it recreates one worker at a time (the cleanup terminates the old one). Nothing to fix. Noted as covered.

7. **`z.instanceof(Uint8ClampedArray)` and the response `lab`/`share` bounds.**
   - Where: `src/workers/palette-protocol.ts:12`, `src/workers/palette-protocol.ts:30-32`.
   - The swatch `lab` numbers have no finite bound and the swatch array has no `.max()`. The worker is our own code, so this is a robustness gap only. Fix: add `.max(MAX_K)` to the swatches array and `z.number().finite()`.

### Checked, nothing found

- **CSP and `worker-src` compatibility.** `src/config/security-headers.ts` sets `worker-src 'self'`, with no `blob:`. The bundled module worker (`new Worker(new URL(...), {type:'module'})`) is same-origin and loads under it. `connect-src 'self'` still holds because images are drawn from the loaded `<img>` via `createImageBitmap` and canvas, never fetched. `img-src` is limited to self, blob, data and framemark. The `home.spec.ts:23` e2e test asserts `worker-src 'self'`. The worker script is served from `/_next/static`, so `script-src 'self'` also covers it. `Cross-Origin-Opener-Policy: same-origin` does not interfere.
- **Untrusted content.** The worker only receives pixels and posts back hex strings validated by `^#[0-9A-F]{6}$`. Swatch hex goes into `style={{ background: swatch.hex }}`, which is safe because the regex is applied on the response before use. There is no `dangerouslySetInnerHTML` in the new files. Image pixels from V&A are data only.
- **Data leaving the browser.** Nothing is sent anywhere. `navigator.clipboard.writeText(hex)` writes only a validated hex string, and a rejected promise is handled (the "Couldn't copy" message). There is no fetch, beacon or analytics in the new code. The worker has no network use.
- **Tainted-canvas handling.** `drawToPixels` throws a SecurityError, which is caught and surfaced as an error state. `crossOrigin="anonymous"` is set on `DesignImage.tsx:30`.
- **Resource bounds.** `fitWithin` caps the analysis at 600 px, and `NaN` or zero natural sizes throw before any allocation.
- **Python script.** The version is pinned and enforced at runtime (`PINNED_VERSION`). The output path is fixed relative to the script, there is no network access, no subprocess, no `eval`, and the seed is deterministic with LF line endings. `convert-sharma.mjs` reads a fixed path, validates the row count and shape, and makes no network call.

### npm audit (all dependencies)

- `npm audit --omit=dev` reports 0 vulnerabilities, so there is nothing in the shipped or runtime dependency tree.
- Full `npm audit` reports 11 moderate vulnerabilities, all dev-only:
  - `minimatch` 7.0.0 to 11.0.0, GHSA-g3hv-75wg-m249 (DoS via globparts amplification), reached through `@stryker-mutator/core`, `@stryker-mutator/vitest-runner` and `@typescript-eslint/*`. The `--force` fix is a breaking `typescript-eslint@8.36.0`, which looks like a downgrade, so it should not be applied blindly.
  - `qs` 2.2.5 to 6.16.0, four advisories (GHSA-q8mj-m7cp-5q26, GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g, GHSA-6pq8-jhm2-2vcw), all DoS, reached through `typed-rest-client`. A non-breaking `npm audit fix` was reported as available.
  - None of these come from `fast-check`.
- The new dev dependency `fast-check@^4.10.2` (lockfile 4.10.2) has one runtime dependency, `pure-rand@^8.0.0`. It is dev-only and not in any client bundle, and its use is justified for property tests of `lib/colour`. Nothing found.

### Other notes

- `docs/threat-model.md` row 22 (hostile pixels or worker messages) is accurate for the zod-validated pixel path. It slightly overstates "every message … is validated with zod": the `analyse-bitmap` message is validated by a separate inline schema in `palette.worker.ts:17-22`, outside `palette-protocol.ts`, and the bitmap bound is a runtime check in `readPixels` (width/height up to 1024, not 600). `docs/runbook.md` is accurate for the palette incident row.
- `docs/cost/ledger.csv` is modified in the working tree and is an unprotected file per the threat model. Expected, harmless data.

## Disposition (author)

| #         | Finding                          | Action                                                                                                                                                                                                                                                                              |
| --------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1        | Sharma hash not checked          | Fixed: `tests/unit/colour-fixtures-integrity.test.ts` pins the raw file's SHA-256 (taken from the original download), checks `rawSha256` in the JSON and the oracle's pinned `colour-science` version. `.gitattributes` marks the raw file `-text`.                                 |
| M2        | venv not ignored                 | Fixed: `.venv*/`, `__pycache__/` and `*.pyc` in `.gitignore`; `.venv*/` in `.prettierignore`, the ESLint `globalIgnores` and the Stryker `ignorePatterns`. Verified with `git check-ignore`.                                                                                        |
| M3        | docs gap                         | Fixed: supply-chain row now covers `fast-check`, the manual Python script, the unhashed transitive Python dependencies as a **known, accepted gap** (no `--require-hashes`, by decision) and the dev-only audit advisories. The same gap is in `tests/fixtures/colour/README.md`.   |
| 4         | bitmap bound after the bitmap    | Fixed: the bitmap's width and height are bounded in the request schema itself, a rejected bitmap is closed, and the threat-model wording is softened to say the checks bound the work after the allocation. Nit 1 (guarded `instanceof`) not done: the worker file is browser-only. |
| 5         | error-path leaks                 | Fixed: `postSnapshot` failures close the bitmap, `fail()` terminates the worker, and a bitmap that arrives after dispose is closed. Unit tests cover each.                                                                                                                          |
| 7         | response bounds                  | Fixed: `.max(MAX_K)` on the response swatches, with tests. `lab` is left as `z.number()` (zod 4 does not accept Infinity or NaN for numbers; not verified separately).                                                                                                              |
| npm audit | `qs` and `minimatch`             | `qs`: `npm audit fix` cannot move it (`typed-rest-client` pins it exactly), so `package.json` has an `overrides` entry for `typed-rest-client` → `qs@6.17.1`. `minimatch`: accepted, dev-only, waiting for upstream (the only fix is a breaking downgrade).                         |
| 3 (low)   | `bitmap` ticket / redundant work | Accepted: bounded and harmless, as the reviewer says.                                                                                                                                                                                                                               |
