---
description: Recommend Claude vs Grok for a task (no execution)
---

Call MCP tool `grok_build_route` with the user's task as `task` and any known signals.
This tool **only recommends** — it does not run Grok, edit files, or change billing.

Present:
- `risk` (LOW / MEDIUM / HIGH)
- `worker` (`claude` | `grok` | `plan_then_grok`)
- `reasons`, `suggestedTool`, `suggestedFlags`, `safetyNotes`
- **`nextAction`** — machine step (`handle_with_claude` | `call_mcp_tool` + tool/flags). Prefer this over re-deriving the plan.

If `nextAction.phase` is `call_mcp_tool` and `requiresHumanGateBeforeDelegate` is true, run
**plan first**, then wait for approval before delegate/verify. If `worker` is `grok` or
`plan_then_grok`, ask before editing tools unless the user already asked to delegate.
After edits, use **`/grok:review`**. Never auto-commit.
