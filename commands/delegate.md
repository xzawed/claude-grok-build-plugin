---
description: Delegate a coding task to Grok
---

Call `grok_auth_check` first. If it returns `ok: false`, stop and show its `message`.
Otherwise call `grok_build_delegate` with the user's task as `prompt` and the current
working directory as `cwd`. Show the returned `summary`, `filesChanged`, and — importantly —
the `billing` field so the user knows whether this ran on their subscription or metered API.
If the result includes **`sessionId`**, note that a later follow-up can use `/grok:resume`
(or `resume` on the next delegate). Do not commit; let the user review the diff.
