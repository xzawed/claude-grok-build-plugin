---
description: Show Grok delegation usage summary (counts, billing, recent)
---

Call `grok_build_usage` and present the summary as a short table. Emphasize the
**billing split** (`byBilling`: subscription vs metered_api) and plan/verify usage
(`counts.plan` / `counts.check`), plus `total` delegations and `totalFilesChanged`. If
`total` is 0, say there are no recorded delegations yet.
