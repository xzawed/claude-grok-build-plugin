---
description: Show Grok delegation usage summary (counts, billing, recent)
---

Call `grok_build_usage` and present the summary as a short table. Emphasize the
**billing split** (`byBilling`: subscription vs metered_api) and plan/verify usage
(`counts.plan` / `counts.check`), plus `total` delegations and `totalFilesChanged`. If
`total` is 0, say there are no recorded delegations yet.

When `recent` rows include **`sessionId`**, mention that the user can continue that
Grok turn with `resume` on `grok_build_delegate` / `/grok:delegate` (do not invent IDs).
