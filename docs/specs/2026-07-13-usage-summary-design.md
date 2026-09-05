# `grok_build_usage` — delegation usage summary — design (Phase 3)

- **Date:** 2026-07-13
- **Status:** approved (brainstorming) → ready for implementation plan
- **[갱신 2026-09-05] 구현·배포 완료** — 현재 배포본은 MCP tool `grok_build_usage`와
  `mcp-server/src/usage.ts`다. 위 상태 줄은 작성 시점 기록으로 보존한다
  (현재 상태의 원천은 `CLAUDE.md`·`docs/06-roadmap.md`).
- **Scope:** Phase 3 optional item "위임 이력 기반 사용량 대시보드". A **read-only**
  summary of `~/.grok-build/history.jsonl` (built in the Phase 2 logging work),
  emphasizing billing (subscription vs metered API) — directly serves absolute
  principle #1 (billing transparency).

## Key decisions (settled during brainstorming)

1. **MCP tool `grok_build_usage`** + a `/grok-build:usage` slash command. The tool
   returns a structured summary; the command tells Claude to call it and present the
   billing split.
2. **No auth / no grok call** — it only reads the local log. No `checkAuth`.
3. Reuses the Phase 2 log at `~/.grok-build/history.jsonl` and its `HistoryEntry` shape;
   no credentials are ever in that log, so none are in the summary.

## Architecture

New module `mcp-server/src/usage.ts`:

- `readHistory(path?: string): HistoryEntry[]` — reads the JSONL file (default
  `defaultHistoryPath()` reused from `history.ts`), parses each line, **tolerantly skips
  malformed lines** (per-line try/catch), returns `[]` if the file is missing.
- `summarizeHistory(entries: HistoryEntry[], opts?: { cwd?: string; limit?: number }): UsageSummary`
  — **pure** aggregation (unit-tested). `cwd` filters to one project; `limit` bounds the
  `recent` list (default 10).

```typescript
interface RecentEntry { ts: string; status: string; mode: string; billing: string; cwd: string; promptPreview: string; }

interface UsageSummary {
  total: number;
  byMode: { subscription: number; api: number };
  byBilling: { subscription: number; metered_api: number };
  byStatus: { completed: number; auth_error: number; timeout: number; grok_error: number };
  counts: { plan: number; check: number; worktree: number };  // special-mode usage
  totalFilesChanged: number;                                   // sum of filesCount
  firstTs?: string;                                            // min ts (omit when total 0)
  lastTs?: string;                                             // max ts
  recent: RecentEntry[];                                       // most-recent-first, ≤ limit
}
```

Aggregation rules (all counters initialised to 0 so every key is always present):
- `byMode`/`byBilling`/`byStatus`: increment per entry's `mode`/`billing`/`status`.
- `counts.plan` = entries with `plan === true`; `counts.check` = `check === true`;
  `counts.worktree` = entries with a `worktreePath`.
- `totalFilesChanged` = sum of `filesCount`.
- `firstTs`/`lastTs` = min/max of `ts` (ISO strings sort lexically); omitted when `total === 0`.
- `recent` = the last `limit` entries, reversed (most recent first), each slimmed to
  `RecentEntry`.

## New MCP tool `grok_build_usage`

- **Input:** `{ cwd?: string; limit?: number }` (both optional).
- **Description:** "Summarize Grok Build delegation history (from ~/.grok-build/history.jsonl):
  counts by mode/billing/status, plan/verify usage, files changed, and recent runs.
  Read-only; highlights subscription vs metered-API billing."
- Handler: `const summary = summarizeHistory(readHistory(), { cwd, limit }); return JSON`.
  No auth pre-check (local read). `isError` false.

## Slash command `/grok-build:usage`

`commands/grok-build-usage.md` — call `grok_build_usage` and present the summary as a
short table, **emphasizing the billing split** (subscription vs metered_api) and the
plan/verify counts.

## Testing plan (TDD)

`mcp-server/test/usage.test.ts`:
- `summarizeHistory`: counts by mode/billing/status; `counts.plan/check/worktree`;
  `totalFilesChanged`; `firstTs`/`lastTs`; `recent` respects `limit` and is
  most-recent-first; `cwd` filter; empty input ⇒ `total: 0`, no `firstTs`/`lastTs`,
  `recent: []`, all sub-counters 0.
- `readHistory`: parses valid JSONL; **skips malformed lines** without throwing; returns
  `[]` for a missing file (inject a temp path).

Tool registration verified via the isolated-bundle `tools/list` smoke (shows
`grok_build_usage`). Docs (04 + 06 + CLAUDE.md) + rebuild the committed `dist/index.js`.

## Out of scope (YAGNI)

An HTML/live UI dashboard; log rotation; dollar cost estimation; time-series charts;
filtering beyond `cwd`; pagination beyond `limit`.
