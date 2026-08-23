---
description: Delegate a coding task to Grok
---

Call `grok_build_status` first (or `grok_auth_check` when you only need auth). If `ready` is
false, stop and show the message. If it reports **`billingMismatch`**, tell the user that the
server is in subscription mode but their delegation history contains metered runs — check
`GROK_BUILD_AUTH_MODE` and any per-model `api_key` in `~/.grok/config.toml`. The flag is about
past history, not a prediction that the next call will bill as metered.

If the task's fit for Grok is unclear, call `grok_build_route` and follow **`nextAction`**.
When it says `handle_with_claude`, do not force Grok. When
`nextAction.requiresHumanGateBeforeDelegate` is set, run `grok_build_plan` and wait for the
user's approval before any edit.

Otherwise call `grok_build_delegate` with the user's task as `prompt` and an absolute `cwd`.
For wide or risky edits pass `worktree: true`, so changes land in an isolated worktree instead
of the working tree.

Show the returned `summary`, `filesChanged`, and — importantly — the `billing` field, so the
user sees which mode the server was configured in. It is a tag derived from
`GROK_BUILD_AUTH_MODE`, not a measured charge. If the result includes
**`sessionId`**, note that a follow-up can use `/grok:resume` (or `resume` on the next
delegate).

Finish at the review gate: run `/grok:review` on the diff. Do not commit — the user decides
accept, fix, or discard.
