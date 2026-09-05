---
description: Read-only Grok plan preview (no edits)
---

Call `grok_build_plan` with the user's task as `prompt` and the current working directory
as `cwd`. Show the returned plan `summary` and the `billing` field — a plan is a real Grok
run on the same path as delegate (it only skips edits), so it carries the same `billing`
tag. If `status` is not `completed` (`auth_error`, `timeout`, or `grok_error`), show the
returned `message` and stop — do not report the run as done.

⚠️ **A plan is not guaranteed read-only.** grok CLI 1.0.13 ignores `--permission-mode plan`
and may edit files (measured 2026-09-05). Always check `planWroteFiles` and `filesChanged`
in the response: if `planWroteFiles` is `true`, tell the user the tree was modified and show
`filesChanged`; if it is absent, say the cwd is not a git repo so the check could not run.
Then use `/grok:delegate` to make the change deliberately.
