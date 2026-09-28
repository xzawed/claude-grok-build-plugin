---
description: Delegate a task to Grok with a self-verification loop
---

Call `grok_auth_check` first, with the task's absolute `cwd`. If it returns `ok: false`, stop and show its `message`.
Otherwise call `grok_build_verify` with the user's task as `prompt` and an **absolute**
`cwd` (a relative path is refused before anything spawns). The server appends a self-verification instruction (CLI 1.0 has no
`--check` flag). Show the returned `summary` (including Grok's verification checklist),
`filesChanged`, and the `billing` field — plus the `message` of `billingCaveat` when the result
carries one (a warning about grok's `config.toml`; do not stop on it). If `committed` is `true`,
grok made a git commit although this plugin never commits — show the returned `message`: it names
the folder whose HEAD moved and the commit it moved from, with how to inspect and undo it there
(never run those commands in another folder). Do not read an empty or short `filesChanged` as
"nothing changed": committed files are no longer listed. If `committed` is absent, the run could
not be checked — do not report "no commit". If `resumedCwd` is present (a `resume` or `continue`
run), the session belongs to that directory and grok worked THERE, not in the `cwd` you passed —
review the diff there. If `status` is not `completed` (`auth_error`,
`timeout`, or `grok_error`), show the returned `message` and stop — do not report the run
as done; `filesChanged` may still list partial edits. Do not commit; let the user review
the diff.
