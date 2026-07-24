# Design: Phase 3.5 Slice B — stable delegate quality

- Date: 2026-07-25
- Status: implement
- Product: reliability first (`docs/00-product-vision.md`) — no billing regressions, no silent over-flagging

## Goals

1. **`filesChanged` precision (cwd mode)** — report paths that became dirty *during* the run
   (`after \ before`), so pre-existing dirty files are not blamed on Grok.
2. **`sessionId` on results** — surface grok JSON `sessionId` for later resume (read-only on result).
3. **Opt-in CLI strengths with hard caps** — `model`, `effort`, `best_of_n` (2–4), `resume` /
   `continue` as spawn args only after validation. Invalid input → **no spawn**, clear `grok_error`.

## Non-goals

- Auto-raising timeout when `best_of_n` is set (caller must pass `timeout_ms` if needed).
- worktree list/diff/apply tools (later slice).
- usage report rewrite (later).
- Changing billing / env strip / `--always-approve` / auto-commit policy.

## Safety rules

| Rule | Behavior |
|---|---|
| Billing | Unchanged — `buildGrokEnv(mode)` only |
| Arg injection | All values via spawn argv array; reject tokens outside safe charset |
| `best_of_n` | Integer **2..4** only (cap 4). Reject otherwise |
| Pre-dirty files | Path still dirty before+after is **omitted** from delta (may under-report). Prefer `worktree: true` for precise attribution on dirty trees — document this |
| Worktree mode | Still `git status` of worktree only (typically clean before) — delta still applied |
| Plan mode | `filesChanged: []` (no git), as today |
| Defaults | Omit new fields → identical argv/behavior to Slice A |

## Done when

- [x] Unit tests cover delta, sessionId, flag wiring, validation rejects, billing invariant still passes
- [x] `npm test` + `npm run build` green; both dist bundles updated
- [x] `docs/04`, roadmap, CLAUDE current status, CHANGELOG updated
