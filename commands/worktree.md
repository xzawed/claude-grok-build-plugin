---
description: List, diff, apply, remove, or prune Grok isolation worktrees
---

Use the MCP tool `grok_build_worktree` (preferred over raw `grok_cli worktree` for
wrapper-managed trees under `~/.grok-build/worktrees`).

1. **list** — `action: "list"`, `cwd` = absolute repo path. Show paths/branches.
2. **diff** — `action: "diff"`, `cwd`, `worktree_path` from a prior delegate with `worktree: true`.
3. **apply** — `action: "apply"` to copy uncommitted worktree diff into `cwd` via `git apply`.
   **Never commit.** Tell the user to review the working tree. If apply fails, do not force.
4. **remove** — `action: "remove"` only for paths under `~/.grok-build/worktrees` (tool enforces).
   It also deletes the companion `grok/<name>` branch with `git branch -d`, so isolated runs stop
   accumulating branches. `-d` (not `-D`) means git refuses when the branch holds unmerged
   commits; the tool then reports `branchDeleted: false` and leaves it for the user.
5. **prune** — `action: "prune"`, `cwd`, optional `max_age_days` (default 7). **Dry run unless**
   `apply: true`. Show the `candidates` list first and let the user decide — a stale worktree can
   still hold changes that were never applied. Suggest `action: "diff"` on anything they are
   unsure about before pruning.

Always use absolute paths. On error, show the tool `message`. Remind: no auto-commit.

Note: grok's own `grok worktree gc` does **not** see these trees — it tracks a different set.
Use this tool, not that one, for anything under `~/.grok-build/worktrees`.
