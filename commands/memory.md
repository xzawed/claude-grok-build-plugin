---
description: Manage Grok cross-session memory
---

Call `grok_cli` with `args` starting `["memory", ...]`. `memory clear` is the only
subcommand grok exposes — there is no `list`/`search` (`grok memory list` exits 2 with
`unrecognized subcommand`), so do not invent one. Memory is otherwise driven from grok's
own TUI (`/memory …`) and `GROK_MEMORY=1`, and lives under `<grok home>/memory/` — and under
`<grok home>/memory-v2/` once grok's `[memory_v2]` is on (below).

`memory clear` is destructive and asks `Are you sure? [y/N]` before deleting. This wrapper
gives grok no stdin, so an unanswered prompt returns `Cancelled.` immediately rather than
hanging — but that also means the clear does nothing. **Confirm the scope with the user
here, then pass `-y`**, which is what actually performs the deletion:

- `["memory","clear","-y"]` — workspace memory for the current directory (the default).
  This is **not just `MEMORY.md`**: it also deletes `sessions/` and `index.sqlite` for that
  workspace, so prior session history goes with it. Say that before you send `-y`.
- `["memory","clear","--global","-y"]` — the global `MEMORY.md` (with `memory_v2` off; see below)
- `["memory","clear","--all","-y"]` — both of the above

**With `[memory_v2] enabled = true` in grok's config, global memory is a whole folder, not one
file.** Measured on grok 1.0.44: `--global -y` and `--all -y` each deleted all of
`<grok home>/memory-v2/global/` — its `MEMORY.md`, `topics/`, `observations/`, `archive/` and index
databases — and left the older `<grok home>/memory/MEMORY.md` in place. What the workspace clear
deletes under `memory_v2` was not measured. Before you send `-y` with `--global` or `--all`, say that
this folder may be what goes.

Never send `-y` on the user's behalf without them having asked for a clear: the flag is the
only thing standing between the request and permanent deletion.

Present `stdoutTail`; on error show `stderrTail`. If `status` is `blocked`, relay the
`message`. Note the reported `billing` (the configured mode, not an observed charge).
