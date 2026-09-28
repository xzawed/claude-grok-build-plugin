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
   - `committed: true` on the result → grok committed (this plugin never does): the edits are in
     that commit, not the working tree. The result's `message` names the folder whose HEAD moved
     and the commit it moved from — review with the `git -C '<folder>' log --stat <before>..HEAD`
     it gives, in that folder only (a command without the folder, run in the project, would show
     the user's own commit when grok worked in a worktree or a resumed session's folder), and relay
     how to undo it. When the folder's name has a single-quote character (`'`, `‘`, `’`, `‚`, `‛`) or
     a control character, the notice puts no folder in the command and says to run it inside that
     folder — run it there, never in another folder. An empty `filesChanged` does not mean nothing changed; an absent `committed` means
     the run could not be checked, not "no commit".
   - `resumedCwd` on the result → the resumed session belongs to that directory and grok worked
     there: review the diff in `resumedCwd`, not in the `cwd` that was passed.
3. Check **billing** on the last Grok tool result:
   - SuperGrok / X Premium+ sessions should show `billing: "subscription"`.
   - Unexpected `metered_api` → the server is running with `GROK_BUILD_AUTH_MODE=api`; that
     setting alone decides the tag (subscription mode strips the API-key vars before spawn).
   - `billingCaveat` on the result → show its `message`. The tag cannot see grok's `config.toml`:
     a model given its own key there is billed to that key, `billing: "subscription"` or not.
     Report it; it is not a reason to stop the review.
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
- Skip showing `filesChanged` / billing / `billingCaveat` when available
