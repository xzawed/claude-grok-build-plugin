---
description: Delegate a coding task to Grok Build (subscription or API mode)
---

Call `grok_auth_check` first. If it returns `ok: false`, stop and show its `message`.
Otherwise call `grok_build_delegate` with the user's task as `prompt` and the current
working directory as `cwd`. Show the returned `summary`, `filesChanged`, and — importantly —
the `billing` field so the user knows whether this ran on their subscription or metered API.
Do not commit; let the user review the diff.
