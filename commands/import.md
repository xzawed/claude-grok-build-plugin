---
description: Import sessions into Grok
---

Call `grok_cli` with `args` starting `["import", ...]` plus any path/flags the user gave.
Present `stdoutTail`; on error show `stderrTail`. If `status` is `blocked`, relay the
`message`. Note the `billing` it ran under.
