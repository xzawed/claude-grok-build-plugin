---
description: Export a Grok session transcript as Markdown
---

Call `grok_cli` with `args` starting `["export", ...]` plus any session id / flags the user
gave. Present `stdoutTail`; on error show `stderrTail`. If `status` is `blocked`, relay the
`message`. Note the reported `billing` (the configured mode, not an observed charge).
