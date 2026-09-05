# Design: Phase 4 Slice A — routing engine (codeified policy)

- Date: 2026-07-25
- Status: shipped — historical design record. Current behaviour: `mcp-server/src/` and `docs/specs/grok-cli-contract.md` (measured). *(Annotated 2026-09-05.)*
- Policy SSOT: `docs/05-routing-policy.md`
- Product: Claude orchestrates; Grok is optional low-cost worker — **never force** bad fits

## Problem

Phase 3.5 skill text helps Claude Code sessions, but a multi-agent orchestrator / Task
Manager needs a **stable, testable API** that maps tasks → worker recommendation without
embedding prose policy in every agent prompt.

## Goals

1. Pure function `routeTask(input) → RouteDecision` encoding LOW / MEDIUM / HIGH.
2. MCP tool `grok_build_route` — **recommend only**, never spawns grok (no billing side effects).
3. Optional command `/grok:route` for humans.
4. Integration note for external orchestrators (JSON contract).

## Decision model

| Risk | Default worker | Tool suggestion |
|---|---|---|
| LOW | `grok` | `grok_build_delegate` or presets |
| MEDIUM | `plan_then_grok` | `grok_build_plan` then delegate/verify; prefer `worktree: true` |
| HIGH | `claude` | do not call grok tools |

Signals (boolean / tags): bulk/repetitive, low risk domain, narrow scope, exploratory,
architecture, security, regulated, monorepo-wide, final review.

Explicit `forceWorker` is **not** supported (avoids silent override of safety).

## Non-goals

- Auto-calling `grok_build_delegate` from the route tool
- ACP
- Changing auth/billing

## Done when

- [x] Unit tests cover LOW/MEDIUM/HIGH and conflict signals (security wins)
- [x] MCP tool registered; no spawn path
- [x] Docs: 05 pointer, 06 Phase 4 Slice A, 07 integration, CLAUDE, CHANGELOG
- [x] `npm test` + build green
