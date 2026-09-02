---
description: Manage Grok cross-session memory
---

Call `grok_cli` with `args` starting `["memory", ...]`. `memory clear` is the only
subcommand grok exposes — there is no `list`/`search` (`grok memory list` exits 2 with
`unrecognized subcommand`), so do not invent one. Memory is otherwise driven from grok's
own TUI (`/memory …`) and `GROK_MEMORY=1`, and lives under `<grok home>/memory/`.

`memory clear` is destructive and asks `Are you sure? [y/N]` before deleting. This wrapper
gives grok no stdin, so an unanswered prompt returns `Cancelled.` immediately rather than
hanging — but that also means the clear does nothing. **Confirm the scope with the user
here, then pass `-y`**, which is what actually performs the deletion:

- `["memory","clear","-y"]` — workspace memory for the current directory (the default)
- `["memory","clear","--global","-y"]` — the global `MEMORY.md`
- `["memory","clear","--all","-y"]` — both

Never send `-y` on the user's behalf without them having asked for a clear: the flag is the
only thing standing between the request and permanent deletion.

Present `stdoutTail`; on error show `stderrTail`. If `status` is `blocked`, relay the
`message`. Note the reported `billing` (the configured mode, not an observed charge).
