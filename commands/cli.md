---
description: Run any Grok CLI command (passthrough)
---

Parse the user's raw Grok arguments into a string array and call `grok_cli` with that as
`args`. This is the escape hatch for any Grok subcommand not covered by a dedicated
`/grok:*` command.

- If `status` is `blocked`, relay the `message` verbatim — the command is a TUI/server/shell
  or interactive-login command that must be run in a real terminal.
- Otherwise present `stdoutTail` (and `stderrTail` on error) and note the reported `billing`
  (the configured mode, not an observed charge; the billing-safe env applies even to a raw
  `-p` prompt).
- **A confirmation prompt gets no stdin**, so a subcommand that asks `Are you sure? [y/N]` exits
  0 with `Cancelled.` and changes nothing — yet the wrapper still reports `status` `ok`. Say the
  run changed nothing, confirm the scope with the user, and only then re-send with that
  subcommand's confirmation flag; `docs/specs/grok-cli-contract.md` §9 lists them — these flags
  gate destructive operations, so never add one on the user's behalf.
- **If `stdoutTruncated` is `true`, `stdoutTail` is only the LAST 4,000 characters** of a longer
  output — `stdoutTotalChars` carries the real size. Say so, quote `stdoutTotalChars`, summarise
  only what is legible in the tail, and never present or parse it as the whole document. A
  passthrough reaches the same large outputs the dedicated commands warn about (`inspect --json`
  measured at ~81 KB); for those, offer the plain form or a redirect to a file.
- Passthrough runs are **not recorded to delegation history** and are **not gated by the
  pre-delegate auth hook** (unlike `/grok:delegate|plan|verify`). Billing stays safe, but for an
  auditable, provenance-tracked coding edit use `/grok:delegate` instead of a raw `-p` passthrough.
