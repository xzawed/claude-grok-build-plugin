---
description: List, search, or restore Grok sessions
---

Call `grok_cli` with `args` starting `["sessions", ...]` plus any subcommand/flags the user
gave. grok 1.0.5 has `list`, `search <q>` and `delete <id>` — there is **no** `restore`
subcommand, so send a "continue that session" request to `/grok:resume` (or
`grok_build_delegate` with `resume`) instead. Present `stdoutTail`; on error show
`stderrTail`. If `status` is `blocked`, relay the `message`. Note the `billing` it ran under.
