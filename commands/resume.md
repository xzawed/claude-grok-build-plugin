---
description: Continue a prior Grok session (multi-turn resume)
---

Continue Grok work **in the same session** instead of starting cold.

## Steps

1. Call `grok_auth_check`. If `ok: false`, stop and show `message`.
2. Call `grok_build_usage` with the project absolute `cwd` (and a small `limit` if desired).
3. Read **`lastSession.sessionId`** (preferred). If missing, scan `recent` for the newest
   entry that has `sessionId`.
4. If still no session id:
   - Tell the user there is no resumable session in history yet.
   - Suggest a fresh `/grok:delegate` (or use `sessionId` from a prior tool result if they
     still have it in chat).
   - Stop without inventing an id.
5. Call `grok_build_delegate` with:
   - `prompt` = the user's follow-up task
   - `cwd` = absolute project path (prefer `lastSession.cwd` when it matches the project)
   - **`resume` = that sessionId** (do not also set `continue`)
6. If `status` is not `completed` (`auth_error`, `timeout`, or `grok_error`), show the
   returned `message` and stop — do not report the run as done; `filesChanged` may still
   list partial edits. Otherwise show `summary`, `filesChanged`, `billing`, and the new
   `sessionId` if returned.
7. **Do not commit** — user/Claude review the diff first.

## Notes

- Resume is for **multi-turn Grok context**, not a substitute for Claude's plan/review.
- Prefer low-risk follow-ups (fix-ups, more tests, same-scope edits). For a new risky
  direction, use `/grok:plan` or a fresh delegate with `worktree: true`.
- Never pass per-call auth mode; billing stays on the server `GROK_BUILD_AUTH_MODE`.
