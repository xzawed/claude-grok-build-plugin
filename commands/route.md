---
description: Recommend Claude vs Grok for a task (no execution)
---

Call MCP tool `grok_build_route` with the user's task as `task` and any known signals.
This tool **only recommends** — it does not run Grok, edit files, or change billing.

Present:
- `risk` (LOW / MEDIUM / HIGH)
- `worker` (`claude` | `grok` | `plan_then_grok`)
- `reasons`, `suggestedTool`, `suggestedFlags`, `safetyNotes`

If `worker` is `grok` or `plan_then_grok`, ask before calling the suggested tool unless the
user already asked to delegate. Never auto-commit after a later delegate.
