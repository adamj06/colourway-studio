---
description: Run the full feature workflow (criteria, tests first, build, review, log)
argument-hint: <feature id> <short description>
---

Feature: $ARGUMENTS

Follow these steps in order and don't skip any. Pause where it says so.

1. **Branch**: create `feat/<feature id>` from main.
2. **Acceptance criteria**: write 3 to 8 testable criteria for this feature, plus what's explicitly out of scope. **Stop and wait for Adam to approve or edit them.**
3. **Unknowns**: if anything depends on an external API shape you haven't seen, delegate to the `api-scout` subagent first.
4. **Tests first**: delegate to the `test-writer` subagent with the approved criteria. Confirm the tests fail for the right reason.
5. **Implement** until the tests pass. Keep `src/lib` pure. Commit in small steps with the required trailers.
6. **Verify**: `npm run lint`, `npm run typecheck`, `npm run test`. Add or update a Playwright test if the feature is user-facing.
7. **Review**: run the `code-reviewer` and `security-reviewer` subagents in parallel. Fix every Must fix and every Critical/High finding. List anything you chose not to fix and why.
8. **Log**: append an entry to `data/build-log.json` in this shape:
   `{ "id", "title", "date", "summary", "models": [], "subagents": [], "humanInterventions": [], "reviewFindingsFixed": number, "prUrl": null }`
   For `humanInterventions`, be honest about where Adam corrected or redirected you.
9. **Report**: a 5-line summary for Adam, then suggest the PR title and description. Don't push; Adam pushes.
