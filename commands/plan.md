---
description: Read-only Grok plan preview (no edits)
---

Call `grok_build_plan` with the user's task as `prompt` and an **absolute** `cwd`
(a relative path is refused before anything spawns). Show the returned plan `summary` and the `billing` field — a plan is a real Grok
run on the same path as delegate (it only skips edits), so it carries the same `billing`
tag. If the result carries `billingCaveat`, show its `message` beside `billing` — a warning that
grok's `config.toml` gives some model its own key (or could not be checked), so do not stop on it. If `status` is not
`completed` (`auth_error`, `timeout`, or `grok_error`), show the returned `message` and stop — do
not report the run as done.

⚠️ **A plan is not guaranteed read-only.** grok 1.0.13 ignored `--permission-mode plan` and
edited anyway (measured 2026-09-05); grok 1.0.30 refuses the write (re-measured 2026-09-22).
The CLI updates itself, so do not assume which of those the user is running — the response
reports what happened in THIS run. Always check `planWroteFiles` and `filesChanged`
in the response: if `planWroteFiles` is `true`, tell the user the tree was modified and show
`filesChanged`; if it is absent, say the cwd is not a git repo so the check could not run.
Then use `/grok:delegate` to make the change deliberately.
