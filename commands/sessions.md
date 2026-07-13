---
description: List, search, or restore Grok sessions
---

Call `grok_cli` with `args` starting `["sessions", ...]` plus any subcommand/flags the user
gave (e.g. `list`, `search <q>`, `restore <id>`). Present `stdoutTail`; on error show
`stderrTail`. If `status` is `blocked`, relay the `message`. Note the `billing` it ran under.
