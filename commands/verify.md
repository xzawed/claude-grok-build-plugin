---
description: Delegate a task to Grok with a self-verification loop
---

Call `grok_auth_check` first. If it returns `ok: false`, stop and show its `message`.
Otherwise call `grok_build_verify` with the user's task as `prompt` and the current working
directory as `cwd`. The server appends a self-verification instruction (CLI 1.0 has no
`--check` flag). Show the returned `summary` (including Grok's verification checklist),
`filesChanged`, and the `billing` field. If `status` is not `completed` (`auth_error`,
`timeout`, or `grok_error`), show the returned `message` and stop — do not report the run
as done; `filesChanged` may still list partial edits. Do not commit; let the user review
the diff.
