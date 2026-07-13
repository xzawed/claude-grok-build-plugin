---
description: Check for or install Grok updates
---

Call `grok_cli` with `args` starting `["update", ...]` plus any flags the user gave.
Present `stdoutTail`; on error show `stderrTail`. If `status` is `blocked`, relay the
`message`.
