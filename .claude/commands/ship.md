---
description: Pre-PR checklist, then prepare the PR
---

1. Confirm we're on a feature branch, not main.
2. Run `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`. Stop on any failure.
3. Check `data/build-log.json` has an entry for this branch's feature.
4. Show `git log main..HEAD --oneline` and check every commit has the `Claude-Model:` and `Feature:` trailers.
5. Draft the PR title and body: what changed, how it was tested, the review findings fixed, and screenshots needed (if UI).
6. Ask Adam before running `git push` and `gh pr create`.
