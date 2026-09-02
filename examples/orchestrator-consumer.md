# Orchestrator consumer kit

Copy-paste reference for an external Task Manager (or Claude session) that uses this
plugin’s MCP tools. **Authoritative contract:** [`docs/07-orchestrator-integration.md`](../docs/07-orchestrator-integration.md).

Pure helpers ship in the plugin source (`mcp-server/src/routing.ts`,
`mcp-server/src/orchestrator.ts`) and are covered by unit tests + fixtures in
[`docs/specs/samples/route-decision-examples.json`](../docs/specs/samples/route-decision-examples.json).

## Invariants (never break)

1. No per-call `authMode` — server `GROK_BUILD_AUTH_MODE` only.
2. No auto-commit / auto-PR after Grok edits.
3. If `nextAction.phase === "handle_with_claude"` (or `worker === "claude"`), **do not** call Grok tools.
4. Observe `billing` on every Grok result (`subscription` vs `metered_api`).
5. Prefer structured `signals` over free-text alone.

## Minimal loop (TypeScript-shaped pseudocode)

```ts
type ExpectedBilling = "subscription" | "metered_api";

async function runTask(task: {
  title: string;
  prompt: string;
  cwd: string; // absolute
  signals?: Record<string, boolean>;
}, expectedBilling: ExpectedBilling) {
  const decision = await mcp.call("grok_build_route", {
    task: task.title,
    signals: task.signals,
    metered_billing: expectedBilling === "metered_api",
  });

  const step = decision.nextAction; // planNextAction(decision)

  if (step.phase === "handle_with_claude") {
    return runClaudeAgent(task);
  }

  if (step.requiresHumanGateBeforeDelegate) {
    const plan = await mcp.call("grok_build_plan", {
      prompt: task.prompt,
      cwd: task.cwd,
    });
    const approved = await humanOrClaudeApproves(plan);
    if (!approved) return runClaudeAgent(task);
    // afterPlanGate(true, decision) → usually grok_build_delegate + worktree
  }

  // After approval the plan step is SPENT. Reusing step.tool here re-calls grok_build_plan and
  // never delegates — step.tool is exactly what held "grok_build_plan" on this branch. The
  // in-plugin helper already computes the follow-up, so take it from there.
  const next = afterPlanGate(approved, decision);   // grok_build_verify or grok_build_delegate
  const tool = step.requiresHumanGateBeforeDelegate
    ? next.tool
    : step.tool ?? decision.suggestedTool ?? "grok_build_delegate";
  const result = await mcp.call(tool, {
    prompt: task.prompt,
    cwd: task.cwd,
    worktree: step.worktree ?? decision.suggestedFlags?.worktree,
    // never pass authMode
  });

  // observeBilling(result.billing, expectedBilling)
  if (result.billing !== expectedBilling) {
    throw new Error(`billing mismatch: ${result.billing}`);
  }

  await reviewDiff(result.filesChanged); // /grok:review — never auto-commit

  // Multi-turn: later resume via result.sessionId or usage.lastSession.sessionId
  return result;
}
```

## Fixture-backed expectations

| Example name | worker | nextAction |
|---|---|---|
| `bulk_low_risk` | `grok` | `call_mcp_tool` → `grok_build_verify` |
| `bulk_delegate` | `grok` | `call_mcp_tool` → `grok_build_delegate` |
| `security_beats_bulk` | `claude` | `handle_with_claude` |
| `vague_task` | `plan_then_grok` | plan + human gate |
| `metered_strict` | `plan_then_grok` | plan + human gate |

Run the same assertions in CI: `mcp-server/test/routing.test.ts` loads the JSON fixtures.

## Claude Code slash path (human-in-the-loop)

```
/grok:status  → ready? billing? lastSession? nextSteps (and billingMismatch)
/grok:route   → read nextAction
/grok:plan    → if gate required
/grok:delegate or /grok:verify
/grok:review  → quality gate
/grok:resume  → multi-turn (lastSession.sessionId)
/grok:usage   → billing mix + lastSession
```

## What this repo does **not** do

- Wire your multi-agent orchestrator process for you (lives in the consumer repo).
- ACP transport (deferred; MCP remains the supported path).
