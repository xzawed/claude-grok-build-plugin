---
description: Export a Grok session trace locally, or upload it to xAI
---

⚠️ **`grok trace` uploads by default.** `--local` is the opt-out, not the opt-in — the help
text for it reads *"Save locally only, skip remote upload"*. A trace is an archive of the
session, so the plain invocation sends session data off the machine. (`--help` does not
enumerate what the archive contains; export with `--local` and look if you need to know.)
Never run the uploading form without the user having asked for an upload.

Usage is `grok trace [OPTIONS] <SESSION_ID>`. There are **no subcommands**, and the session
id is **required** — get one from `/grok:sessions` or a prior result's `sessionId`.

Call `grok_cli` with:

- `["trace","--local","<session-id>"]` — export to disk only. **Default to this.**
- `["trace","--local","-o","<path>","<session-id>"]` — choose the output path
  (otherwise `<grok home>/trace-exports/<session-id>.tar.gz`).
- `["trace","<session-id>"]` — **uploads to xAI.** Only after the user has explicitly asked
  to upload, and say plainly that it is leaving the machine.
- add `--json` for machine-readable output.

Present `stdoutTail`; on error show `stderrTail`. If `status` is `blocked`, relay the
`message`. Note the reported `billing` (the configured mode, not an observed charge).
