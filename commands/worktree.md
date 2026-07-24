---
description: List, diff, apply, or remove Grok isolation worktrees
---

Use the MCP tool `grok_build_worktree` (preferred over raw `grok_cli worktree` for
wrapper-managed trees under `~/.grok-build/worktrees`).

1. **list** — `action: "list"`, `cwd` = absolute repo path. Show paths/branches.
2. **diff** — `action: "diff"`, `cwd`, `worktree_path` from a prior delegate with `worktree: true`.
3. **apply** — `action: "apply"` to copy uncommitted worktree diff into `cwd` via `git apply`.
   **Never commit.** Tell the user to review the working tree. If apply fails, do not force.
4. **remove** — `action: "remove"` only for paths under `~/.grok-build/worktrees` (tool enforces).

Always use absolute paths. On error, show the tool `message`. Remind: no auto-commit.
