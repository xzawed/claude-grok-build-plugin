---
description: Delegate a coding task to Grok
---

Call `grok_build_status` first (or `grok_auth_check` when you only need auth). If `ready` is
false, stop and show the message. If it reports **`billingMismatch`**, stop and warn the user
about stray API keys / `GROK_BUILD_AUTH_MODE` before spending anything — that flag means work
would bill as metered API instead of their subscription.

If the task's fit for Grok is unclear, call `grok_build_route` and follow **`nextAction`**.
When it says `handle_with_claude`, do not force Grok. When
`nextAction.requiresHumanGateBeforeDelegate` is set, run `grok_build_plan` and wait for the
user's approval before any edit.

Otherwise call `grok_build_delegate` with the user's task as `prompt` and an absolute `cwd`.
For wide or risky edits pass `worktree: true`, so changes land in an isolated worktree instead
of the working tree.

Show the returned `summary`, `filesChanged`, and — importantly — the `billing` field, so the
user knows whether this ran on their subscription or metered API. If the result includes
**`sessionId`**, note that a follow-up can use `/grok:resume` (or `resume` on the next
delegate).

Finish at the review gate: run `/grok:review` on the diff. Do not commit — the user decides
accept, fix, or discard.
