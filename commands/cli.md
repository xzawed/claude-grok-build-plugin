---
description: Run any Grok CLI command (passthrough)
---

Parse the user's raw Grok arguments into a string array and call `grok_cli` with that as
`args`. This is the escape hatch for any Grok subcommand not covered by a dedicated
`/grok:*` command.

- If `status` is `blocked`, relay the `message` verbatim — the command is a TUI/server/shell
  or interactive-login command that must be run in a real terminal.
- Otherwise present `stdoutTail` (and `stderrTail` on error) and note the `billing` it ran
  under (the billing-safe env applies even to a raw `-p` prompt).
- Passthrough runs are **not recorded to delegation history** and are **not gated by the
  pre-delegate auth hook** (unlike `/grok:delegate|plan|verify`). Billing stays safe, but for an
  auditable, provenance-tracked coding edit use `/grok:delegate` instead of a raw `-p` passthrough.
