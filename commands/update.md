---
description: Check for a Grok update, or install one
---

⚠️ **A bare `grok update` installs.** Checking is the opt-in `--check`. So "is there a new
version?" must not become a binary replacement.

Call `grok_cli` with:

- `["update","--check","--json"]` — **the default for any question about versions.** Returns
  `currentVersion` / `latestVersion` / `updateAvailable` and changes nothing.
- `["update"]` — downloads and installs. Only when the user explicitly asked to update.
- `["update","--version","<v>"]` to pin a version, `--alpha` / `--stable` to switch channel,
  `--force-reinstall` to re-download the current version.

When you do install, pass a larger `timeout_ms` (the default is 60 s and a slow download is
SIGKILLed mid-install, surfacing as `status: "timeout"` after the binary was already being
replaced). Note the CLI also updates itself outside this command — a version measured today
is not a version guaranteed tomorrow.

Present `stdoutTail`; on error show `stderrTail`. If `status` is `blocked`, relay the
`message`.
