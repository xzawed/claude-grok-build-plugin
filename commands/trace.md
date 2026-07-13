---
description: Export or upload Grok session trace data
---

Call `grok_cli` with `args` starting `["trace", ...]` plus the user's subcommand/flags.
Present `stdoutTail`; on error show `stderrTail`. If `status` is `blocked`, relay the
`message`. Note the `billing` it ran under.
