---
description: Manage Grok git worktrees
---

Call `grok_cli` with `args` starting `["worktree", ...]` plus the user's subcommand/flags.
Present `stdoutTail`; on error show `stderrTail`. If `status` is `blocked`, relay the
`message`. Note the `billing` it ran under.
