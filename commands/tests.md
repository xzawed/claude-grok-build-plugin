---
description: Backfill or expand tests with Grok (preset)
---

Preset: use Grok for **test backfill / expansion** — a strong Grok fit (low risk, repetitive).

1. Call `grok_auth_check` with the absolute `cwd` you will delegate into. If `ok: false`, show `message` and stop (guide `/grok:setup`).
2. Build an English `prompt` that includes:
   - What to test (paths, functions, or "cover untested code in …")
   - Constraints (framework, no flaky time/network, match existing style)
   - Done criteria (tests run or at least compile; no production behavior change unless asked)
3. Prefer `grok_build_verify` (self-check) with absolute `cwd`. If the user wants a plan only, use `grok_build_plan` first.
4. For large or risky suites touching many packages, set `worktree: true`.
5. If `status` is not `completed` (`auth_error`, `timeout`, or `grok_error`), show the
   returned `message` and stop — do not report the run as done; `filesChanged` may still
   list partial edits. Otherwise show `summary`, `filesChanged`, and **`billing`** — plus the
   `message` of `billingCaveat` when the result carries one (a warning; do not stop on it).
   If `committed` is `true`, grok made a git commit although this plugin never commits — show
   the returned `message`: it names the folder whose HEAD moved and the commit it moved from,
   with how to inspect and undo it there (never run those commands in another folder). Do not
   read an empty or short `filesChanged` as "nothing changed": committed files are no longer
   listed. If `committed` is absent, the run could not be checked — do not report "no commit".
   Review diffs; do not commit.
