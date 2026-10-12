---
description: Manage Grok cross-session memory
---

Call `grok_cli` with `args` starting `["memory", ...]`. `memory clear` is the only
subcommand grok exposes — there is no `list`/`search` (`grok memory list` exits 2 with
`unrecognized subcommand`), so do not invent one. Memory is otherwise driven from grok's
own TUI (`/memory …`).

`memory clear` is destructive and asks `Are you sure? [y/N]` before deleting. This wrapper
gives grok no stdin, so an unanswered prompt returns `Cancelled.` immediately rather than
hanging — but that also means the clear does nothing. **Confirm the scope with the user
here, then pass `-y`**, which is what actually performs the deletion:

- `["memory","clear","-y"]` — workspace memory (the default). grok picks the workspace from
  the git repository in `cwd` (by its `origin`), so every clone and worktree of that
  repository shares it: pass the user's project folder as `cwd`.
- `["memory","clear","--global","-y"]` — global memory
- `["memory","clear","--all","-y"]` — both

**When you confirm the scope — before the user's yes — say that each scope can go as a whole
folder:** every note in it, its `MEMORY.md`, `topics/`, `observations/`, `archive/`, index
databases and, in the older layout, `sessions/` — and, for the workspace, that it belongs to the
repository, so it goes for every clone and worktree of it. Say this whatever the grok version or
memory settings: understating a permanent deletion is the failure to avoid, and the narrower cases below
are not worth relying on. What was measured:

- grok 1.0.50 (2026-10-12), under every memory setting tried: the workspace clear deleted
  `<grok home>/memory-v2/workspaces/<project>-<hash8>/` and `--global` deleted
  `<grok home>/memory-v2/global/`, each a whole folder; `--all` both. The older
  `<grok home>/memory/` was left in place.
- grok 1.0.44: the same folders with `[memory_v2] enabled = true` in grok's config (the older
  tree stayed); without it, the older tree — the workspace's whole
  `<grok home>/memory/<project>-<hash8>/` folder (its `MEMORY.md`, `sessions/` and
  `index.sqlite`), and for `--global` only `<grok home>/memory/MEMORY.md`.

After a run with `-y`, relay what grok printed: its `Cleared:` lines are what went. grok prints
`The following will be deleted:` on a cancelled run too, so that list alone does not mean anything
went — `Cancelled.` and no `Cleared:` line mean nothing changed. A scope you asked for that grok
did not list (with `--all`, the workspace) was not cleared. `Nothing to clear` means only that
grok found nothing in the folders it targets, not that no memory is left: measured, grok 1.0.50
said it while notes sat in the older `<grok home>/memory/`, which it never clears. So do not tell
the user their memory is gone; for the workspace, check that `cwd` was the user's project, since
another repository's memory is a different workspace.

Never send `memory clear` — with or without `-y` — unless the user asked for a clear and you have
confirmed the scope. Without `-y`, today's grok asks and cancels, but that prompt is grok's, not a
safety net: do not send it without `-y` to see or list what would go, because a grok that stops
asking deletes on that run.

Present `stdoutTail`; on error show `stderrTail`. If `status` is `blocked`, relay the
`message`. Note the reported `billing` (the configured mode, not an observed charge).
