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
4. **Usage:** `usageHeadline`, success/subscription rates when present
5. **Last session:** `lastSession.sessionId` if any → mention `/grok:resume`
6. **Next:** follow `nextSteps` (do not invent IDs or skip billing)

Read-only — no edits, no commit. For post-edit review use `/grok:review`.
