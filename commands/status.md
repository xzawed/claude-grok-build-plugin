---
description: Dashboard — auth ready, billing, usage, last session
---

Call **`grok_build_status`** (preferred one-shot). If unavailable, call `grok_auth_check`
then `grok_build_usage` and combine.

Present a short dashboard:

1. **Ready?** `ready` / `authMessage` (and `reason` if not ready → guide `/grok:setup`)
2. **Mode & expected billing** (`mode`, `billing`) + **`serverVersion`**
3. **Billing mismatch?** if `billingMismatch: true`, warn prominently — the server is in
   subscription mode but past delegations were recorded as metered, so `GROK_BUILD_AUTH_MODE`
   was `api` for some of them
4. **Billing caveat?** if `billingCaveat` is present, show its `message` prominently. With
   `reason: "config_model_keys"`, grok's `config.toml` gives the listed `models` their own key,
   which grok uses before the subscription session — runs on those models may be billed to that
   key even though `billing` says `subscription`. With `reason: "config_unreadable"`, that could
   not be checked. It is a warning, not a reason to stop: do not refuse later delegations for it
5. **Relative `GROK_HOME`?** if `grokHomeNote` is present, show it: grok resolves a relative
   `GROK_HOME` against the folder it runs in, so this dashboard answered for one folder only
6. **Usage:** `usageHeadline`, success/subscription rates when present
7. **Last session:** `lastSession.sessionId` if any → mention `/grok:resume`
8. **Next:** follow `nextSteps` (do not invent IDs or skip billing)

Read-only — no edits, no commit. For post-edit review use `/grok:review`.
