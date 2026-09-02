---
description: Show Grok delegation usage summary (counts, billing, recent)
---

Call `grok_build_usage` and present the summary as a short table. Emphasize the
**billing split** (`byBilling`: subscription vs metered_api) and plan/verify usage
(`counts.plan` / `counts.check`), plus `total` delegations and `totalFilesChanged`. If
`total` is 0, say there are no recorded delegations yet.

When **`lastSession.sessionId`** (or a `recent` row with `sessionId`) is present, mention
that the user can continue with **`/grok:resume`** or `grok_build_delegate` + `resume`
(do not invent IDs).

Note for the user if they ask where this comes from: it is `~/.grok-build/history.jsonl`,
appended once per delegation, and each row carries the first ~200 characters of that
delegation's prompt. Known secret shapes are redacted before writing, but that is pattern
matching, not a guarantee. Deleting the file clears the history and breaks nothing else.
