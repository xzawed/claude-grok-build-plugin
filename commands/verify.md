---
description: Delegate a task to Grok with a self-verification loop
---

Call `grok_auth_check` first. If it returns `ok: false`, stop and show its `message`.
Otherwise call `grok_build_verify` with the user's task as `prompt` and the current working
directory as `cwd`. Show the returned `summary` (including Grok's verification / action-trace),
`filesChanged`, and the `billing` field. Do not commit; let the user review the diff.
