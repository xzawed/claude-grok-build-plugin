---
description: Manage Grok cross-session memory
---

Call `grok_cli` with `args` starting `["memory", ...]`. grok 1.0.5 exposes only
`memory clear` — there is no `list`/`search` subcommand (`grok memory list` exits 2 with
`unrecognized subcommand`), so do not invent one. Memory is otherwise driven from grok's
own TUI (`/memory …`) and `GROK_MEMORY=1`.

Present `stdoutTail`; on error show `stderrTail`. If `status` is `blocked`, relay the
`message`. Note the reported `billing` (the configured mode, not an observed charge).
