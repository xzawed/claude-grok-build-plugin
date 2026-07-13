# `grok_build_verify` — delegate + self-verification (`--check`) — design (Phase 3)

- **Date:** 2026-07-13
- **Status:** approved (brainstorming) → ready for implementation plan
- **Scope:** Phase 3 item `grok_build_verify` — delegate a task to grok and have it
  **self-verify** its own work (build/test/checklist), returning the work plus a
  verification report.

## Measured constraint (grok 0.2.93, this machine) — the roadmap premise was wrong

The roadmap imagined wrapping a grok "`/verify`" that runs sandbox build/test/browser
smoke tests and produces screenshot/video evidence. **No such headless feature exists**
in grok's CLI: there is no `verify` subcommand and no `--verify`/`--screenshot` flag.

What DOES exist is **`--check`: "Append a self-verification loop to the prompt (headless
only)"**. Measured (`grok --always-approve --check -p "add subtract(a,b) to math.js"`):
- **`stopReason: "EndTurn"`** (same success semantics as a normal delegation).
- grok **edits the file** AND then runs a self-verification loop — it "spawns the
  verifier subagent per `/check-work`" and returns a **Checklist + Action-Trace table**
  (item → what was done → result) in the `text`.

**So `grok_build_verify` = a delegation that adds `--check`.** grok does the task and
self-verifies; the verification evidence comes back in `summary` (grok's text). No
success-semantics change (unlike plan mode) — `--check` only appends verification.

## Key decisions (settled during brainstorming)

1. **Separate MCP tool `grok_build_verify`** (not a bare field) — a clearly-named entry
   point ("do this and verify it"), internally `runDelegate({ check: true })`.
2. Reuses the full delegate flow incl. **`worktree`/`sandbox`** (verify edits like a
   delegation, so isolation + fs limits are relevant) and the standard EndTurn success
   test and `filesChanged`.
3. The standalone "verify existing state, no task" and "screenshot/video evidence" ideas
   are **out of scope / unfounded** — `--check` verifies a task's own work.

## New MCP tool: `grok_build_verify`

- **Input:** `{ prompt, cwd, timeout_ms?, worktree?, sandbox? }` (same as delegate).
- **Description:** "Delegate a task to Grok Build AND have it self-verify its own work
  (runs a verification loop; returns the changes plus a checklist / action-trace report).
  Use for changes you want grok to validate."
- **Output:** same shape as `grok_build_delegate` — `status: "completed"` on EndTurn,
  `summary` = grok's text **including the self-verification report**, `filesChanged` from
  git, `worktreePath?` when isolated.
- Handler: auth pre-check → `runDelegate(mode, { prompt, cwd, timeoutMs, worktree, sandbox, check: true })`
  → `recordDelegation(...)` → return. (Shares auth/billing/logging.)

## `runDelegate` change — `input.check?: boolean`

```typescript
// DelegateInput gains: check?: boolean

const args = [
  '--no-auto-update',
  ...(input.plan ? ['--permission-mode', 'plan'] : ['--always-approve']),
  ...(input.check ? ['--check'] : []),
  '--cwd', effectiveCwd,
  '-p', input.prompt, '--output-format', 'json',
  ...(input.sandbox ? ['--sandbox', input.sandbox] : []),
];
```

That is the ONLY runDelegate change — everything else (worktree, filesChanged, EndTurn
classification via `classifySpawnResult`) is unchanged. `check` and `plan` are set by
different tools and are never combined (`--check` needs execution, which plan mode
forbids); if both were somehow set, plan's `--permission-mode plan` and `--check` would
both be appended, but no tool does this.

## History

`HistoryEntry` gains `check?: boolean`; `buildHistoryEntry` sets `entry.check = true`
when `input.check`. Verify runs are logged like any delegation, marked `check: true`.

## Testing plan (TDD)

`mcp-server/test/delegate.test.ts` (extend):
- check mode argv: contains `--check` AND still `--always-approve`; EndTurn ⇒ `completed`
  with `summary` = text and `filesChanged` from git (same as a normal delegation).
- non-check path: no `--check` in argv.

`mcp-server/test/history.test.ts` (extend): `check: true` carried when `input.check`, omitted otherwise.

Tool registration verified via the isolated-bundle `tools/list` smoke (shows
`grok_build_verify` with `{prompt, cwd, timeout_ms, worktree, sandbox}`). A real-grok e2e
(delegate a small change with `check: true`) confirms the summary carries the
verification checklist/action-trace and the edit lands.

Docs (04 new tool + 06 mark done + CLAUDE.md) + rebuild the committed `dist/index.js`.

## Out of scope (YAGNI)

Standalone "verify current state without a task"; parsing the checklist/action-trace into
structured pass/fail (return grok's text as-is); screenshot/video evidence (not available
via `--check`); combining `plan` + `check`.
