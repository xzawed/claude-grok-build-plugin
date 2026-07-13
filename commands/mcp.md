---
description: Manage Grok's MCP server configurations
---

Call `grok_cli` with `args` starting `["mcp", ...]` plus the user's subcommand/flags
(`list`, `add`, `remove`, `doctor`). Present `stdoutTail`; on error show `stderrTail`. If
`status` is `blocked`, relay the `message`. Note the `billing` it ran under.
