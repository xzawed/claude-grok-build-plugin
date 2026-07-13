# `grok_build_plan` — plan-mode preview — design (Phase 3)

- **Date:** 2026-07-13
- **Status:** approved (brainstorming) → ready for implementation plan
- **Scope:** Phase 3 item `mode: "plan"` — a read-only "what would you do?" preview from
  grok, with **no edits**, before committing to a real (editing) delegation.

## Measured constraint (grok 0.2.93, this machine)

`grok --no-auto-update --permission-mode plan --cwd <DIR> -p "<PROMPT>" --output-format json`
(no `--always-approve`):
- **`stopReason: "Cancelled"`** (NOT `EndTurn`) — plan mode never gets approval to
  execute, so it ends "Cancelled".
- **No file is edited** (`git status` clean after).
- `text` = grok's plan/intent narration (the plan to return).

**Implication:** the normal success test `stopReason === "EndTurn"` would misclassify a
successful plan as `grok_error`. Plan mode must treat a parsed result **with text** as
success regardless of `Cancelled`/`EndTurn`, and must **not** pass `--always-approve`.

## Key decisions (settled during brainstorming)

1. **Separate MCP tool `grok_build_plan`** (not a field on `grok_build_delegate`) — plan
   is a read-only preview with different semantics (no edits, `Cancelled` = success, no
   `filesChanged`). Internally it reuses `runDelegate` via an `input.plan` flag.
2. Plan mode uses `--permission-mode plan` in place of `--always-approve`.
3. `filesChanged` is `[]` in plan mode — we skip `git status` entirely (plan makes no
   edits; running `git status` on a dirty repo would over-report unrelated changes).

## New MCP tool: `grok_build_plan`

- **Input:** `{ prompt: string; cwd: string; timeout_ms?: number }` (no `worktree`/`sandbox`
  — nothing is edited, so isolation is moot).
- **Description:** "Ask Grok Build for a plan/approach for a task **without editing any
  files** (read-only preview). Use before `grok_build_delegate` to preview grok's approach."
- **Output (success):** `{ status: "completed", mode, billing, summary /* the plan */, filesChanged: [] }`
- **Output (failure):** same shape as `grok_build_delegate` (`auth_error`/`timeout`/`grok_error`).
- Handler: auth pre-check → `runDelegate(mode, { prompt, cwd, timeoutMs, plan: true })` →
  `recordDelegation(...)` → return. (Same auth/billing/logging path as delegate.)

## `runDelegate` change — `input.plan?: boolean`

```typescript
// DelegateInput gains: plan?: boolean

const approvalArgs = input.plan ? ['--permission-mode', 'plan'] : ['--always-approve'];
const args = [
  '--no-auto-update', ...approvalArgs, '--cwd', effectiveCwd,
  '-p', input.prompt, '--output-format', 'json',
  ...(input.sandbox ? ['--sandbox', input.sandbox] : []),
];
// ... spawn ...
const filesChanged = input.plan ? [] : await gitChangedFiles(effectiveCwd);
// ... timeout / parse-fail / auth_error branches unchanged (carry filesChanged) ...

// AFTER a successful parse, BEFORE the EndTurn check:
if (input.plan) {
  const planText = (parsed.text ?? '').trim();
  if (!planText) {
    return { status: 'grok_error', mode, billing, message: 'Grok Build가 계획을 반환하지 않았습니다.', filesChanged, worktreePath };
  }
  return { status: 'completed', mode, billing, summary: parsed.text, filesChanged, worktreePath };
}

// existing: if (parsed.stopReason !== 'EndTurn') { grok_error } ... else completed
```

- Non-plan behavior is unchanged (existing tests stay green).
- `worktreePath` is always `undefined` for plan calls (the plan tool never sets
  `worktree`), so it is omitted from the JSON.

## History

`HistoryEntry` gains `plan?: boolean`. `buildHistoryEntry` sets `entry.plan = true` when
`input.plan`. Plan runs are still real grok invocations (billing applies), so they are
logged like any delegation, marked `plan: true` for provenance.

## Testing plan (TDD)

`mcp-server/test/delegate.test.ts` (extend):
- plan mode argv: contains `--permission-mode`, `plan`; does NOT contain `--always-approve`.
- plan success: a `Cancelled` stopReason with text ⇒ `status: "completed"`,
  `summary` == the plan text, `filesChanged` == `[]` (even when `gitChangedFiles` would
  return files — assert it is skipped).
- plan with empty text ⇒ `grok_error`.
- non-plan path unchanged (existing tests green; still `--always-approve`).

`mcp-server/test/history.test.ts` (extend): `plan: true` carried when `input.plan`, omitted otherwise.

Tool registration is verified via the isolated-bundle smoke (`tools/list` shows
`grok_build_plan` with `{prompt, cwd, timeout_ms}`).

Docs (04 new tool + 06 mark done + CLAUDE.md) + rebuild the committed `dist/index.js`.

## Out of scope (YAGNI)

`worktree`/`sandbox` on the plan tool (no edits); parsing the plan into structured steps
(return grok's text as-is); an automatic plan→execute chain; a distinct `planned` status
(reuse `completed`).
