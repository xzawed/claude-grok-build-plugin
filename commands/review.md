---
description: Review Grok output (diff gate — never auto-commit)
---

Post-delegation **quality gate**. Use after `grok_build_delegate` / `verify` / `resume`
(or when the user asks to review Grok's work).

## Steps

1. If you do not already have the last result, call `grok_build_usage` with project `cwd`
   and note `recent[0]` / `lastSession` / insights. Do not invent `sessionId`s.
2. Inspect **working tree diff** for the files Grok touched (`filesChanged` from the tool
   result, or `git status` / `git diff` in the project). Prefer the listed paths; if
   worktree isolation was used, use `grok_build_worktree` diff/apply as needed.
3. Check **billing** on the last Grok tool result:
   - SuperGrok / X Premium+ sessions should show `billing: "subscription"`.
   - Unexpected `metered_api` → warn about API key override / `GROK_BUILD_AUTH_MODE`.
4. Adversarial review (Claude owns this — do not re-delegate the review itself):
   - Correctness vs the original task
   - Security / secrets / dangerous defaults
   - Tests or docs left incomplete
   - Scope creep outside the request
5. Present a short verdict: **accept / fix-with-Claude / fix-with-Grok (`/grok:resume`)** /
   **discard** (worktree remove if isolated).
6. **Never commit or open a PR** unless the user explicitly asks after the review.

## Do not

- Auto-commit, auto-PR, or force-push
- Call Grok for HIGH-risk security/architecture final judgment without user intent
- Skip showing `filesChanged` / billing when available
