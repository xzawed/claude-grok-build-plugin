---
description: Manage Grok cross-session memory
---

Call `grok_cli` with `args` starting `["memory", ...]` plus any subcommand/flags the user
gave. Present `stdoutTail`; on error show `stderrTail`. If `status` is `blocked`, relay the
`message`. Note the `billing` it ran under.
