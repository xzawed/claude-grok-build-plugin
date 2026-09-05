---
description: Read-only Grok plan preview (no edits)
---

Call `grok_build_plan` with the user's task as `prompt` and the current working directory
as `cwd`. Show the returned plan `summary` and the `billing` field — a plan is a real Grok
run on the same path as delegate (it only skips edits), so it carries the same `billing`
tag. If `status` is not `completed` (`auth_error`, `timeout`, or `grok_error`), show the
returned `message` and stop — do not report the run as done. No files are edited
(read-only preview) — use
`/grok:delegate` afterward to actually make the change.
