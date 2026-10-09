---
description: Run any Grok CLI command (passthrough)
---

Parse the user's raw Grok arguments into a string array and call `grok_cli` with that as
`args`. This is the escape hatch for any Grok subcommand not covered by a dedicated
`/grok:*` command.

- If `status` is `blocked`, relay the `message` verbatim and do not retry. Two things get refused
  without spawning: a TUI/server/shell or interactive-login command, which must be run in a real
  terminal; and a bare word grok would take as its PROMPT — a first argument that is not a
  subcommand grok knows, including one behind flags such as `-w <name>`, `-r <id>`, `-c`,
  `--always-approve` or `--`. A prompt without `-p` opens grok's interactive UI, and measured, that
  UI sent the word to the model within seconds — a turn the auth hook and the delegation history
  never see. Usually the word is a typo (`grok sesions`); for real work use `/grok:delegate`. If the
  token is a real but new subcommand, this wrapper has not learned it yet: say so and point the user
  at their terminal rather than guessing a spelling.
- Otherwise present `stdoutTail` (and `stderrTail` on error) and note the reported `billing`
  (the configured mode, not an observed charge; the billing-safe env applies even to a raw
  `-p` prompt).
- **Confirm the scope with the user BEFORE sending anything that deletes, installs or changes
  settings — a confirmation prompt is not a safety net.** Some destructive subcommands never ask:
  measured, `plugin uninstall <name>` for a plugin that is the only one from its source deleted it
  at once (exit 0, `status: ok`, no `cancelled`). Never add a confirmation flag (`-y`, `--yes`,
  `--confirm`, `--trust`) the user did not ask for — it is all that stands between the request and
  a change that cannot be undone.
- **If `cancelled` is `true`, the command ran and did NOTHING.** A confirmation prompt gets no stdin,
  so a subcommand that asks `Are you sure? [y/N]` takes the default N and exits 0 — `status` is
  `ok` because the process really did exit 0. Do not read that as success: say the run changed
  nothing and relay `message`. Re-send with the subcommand's confirmation flag (grok's output or
  `grok <subcommand> --help` names it) only once the user has confirmed the scope. (`cancelled` is
  detected on the whole output, so it survives the `stdoutTail` cut that used to hide the evidence.)
- **If `stdoutTruncated` is `true`, `stdoutTail` is a 4,000-character slice of a longer output,
  and `stdoutKept` says which end you got** — `head` for `inspect` and help, whose meaning is at
  the top; `tail` for everything else, whose outcome is at the bottom. `stdoutTotalChars` carries
  the real size. Say the output was cut, quote that number, summarise only what is legible in the
  slice, and never present or parse it as the whole document.
- **If `stdoutCutShort` is `true`, the output may stop mid-text** — the run hit its time cap, or grok
  exited while something it started still held its output past a 2-second grace. Say the output may be
  incomplete and do not read its last line as the outcome.
- **`max_chars` raises the budget for one call** (ceiling 100,000) when you genuinely need the whole
  document — `inspect --json` measured at ~81 KB, and no 4,000-character slice of it parses as JSON.
  It is real tokens, so say why you are asking for it; otherwise offer the plain form or a
  redirect to a file.
- **A passthrough that carries a prompt is a real turn, and is treated as one.** If `args` contain
  `-p`, `--single` (or its hidden alias `--print`), `--prompt-file` or `--prompt-json`, the run is gated by the pre-delegate auth
  hook and recorded to delegation history with `via: "grok_cli"` — it shows up in `/grok:usage`
  and `/grok:status` beside ordinary delegations, and the result carries `promptRun` and
  `filesChanged`. Read-only subcommands (`sessions`, `models`, `inspect`, `--version`) are
  neither gated nor recorded: they spend nothing, and blocking them would break the commands you
  run to work out why you are signed out.
- **Pass the project's absolute `cwd` with a prompt run.** When `GROK_HOME` depends on the folder — a
  relative path, or on Windows one like `\grok` that starts at the drive root with no drive letter — the
  hook can only check a folder it knows: without `cwd`, or with `--cwd` in the args, it lets the run
  through, and since `grok_cli` has no server-side check, grok's own check is the only one left.
- Prefer `/grok:delegate` for coding edits anyway — it adds worktree isolation, plan mode and a
  structured result. The passthrough is for the cases the dedicated commands do not cover.
- **A `--permission-mode plan` passed here is not `/grok:plan`.** The arguments go to grok as given, so
  that run carries none of the deny rules `/grok:plan` adds, and your own allow rules can approve writes,
  commits and pushes in it. For a plan preview, use `/grok:plan`.
