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
`filesChanged`; if it is absent, the check could not run — say so, and never report the plan as
read-only. A folder grok may have worked in could not be read, or the run continued in a folder that
was not known before it. On a completed plan the returned `message` says which; on a failed ending
the `message` starts with the failure's own text, which is not the reason, so do not present it as
the reason — only a later sentence that says the check could not be done is. `planWroteFiles` is
reported on every ending where it could be checked, failed ones included.
If `committed` is `true`, the plan run made a git commit (HEAD moved): show the returned `message`,
which names the folder whose HEAD moved and the commit it moved from, with how to inspect and undo it
there (never run those commands in another folder) — the committed files are no longer in
`filesChanged`. If `committed` is absent, the run could not be checked — do not report "no commit".
If `resumedCwd` is present, the plan ran in that folder, not the `cwd` you passed. Then use
`/grok:delegate` to make the change deliberately.
