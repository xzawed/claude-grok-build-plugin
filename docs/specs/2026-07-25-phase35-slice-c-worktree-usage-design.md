# Design: Phase 3.5 Slice C — worktree lifecycle + usage insights

- Date: 2026-07-25
- Status: implement
- Depends on: Slice B (filesChanged delta / sessionId / capped flags)
- Product: safer collab loop + “use subscription well” feedback

## Goals

1. **Worktree lifecycle tools** (no auto-commit):
   - `list` — porcelain `git worktree list` for `cwd`, filter to wrapper paths / `grok/*` branches when possible
   - `diff` — uncommitted changes summary in a worktree (`status` paths + `diff --stat` text)
   - `apply` — apply worktree uncommitted diff onto main `cwd` via `git apply` (check first); **never commit**
   - `remove` — `git worktree remove` only if path is under `~/.grok-build/worktrees` (hard safety bound)
2. **Usage insights** — pure fields on `summarizeHistory`: success rate, subscription share, short headline + tips.

## Safety

| Rule | Behavior |
|---|---|
| Auto-commit | Never |
| Apply | `git apply --check` then `git apply`; fail closed on conflict |
| Remove | Refuse paths outside `~/.grok-build/worktrees` |
| List/diff | Read-only git |
| Billing | Unchanged |

## Non-goals

- Automatic merge of committed worktree branches
- Deleting random user worktrees outside our base dir
- Full interactive UI

## Done when

- [x] Unit tests for path gate, apply dry-run failure, insights math
- [x] `npm test` + build green; docs/roadmap/CHANGELOG/CLAUDE updated
