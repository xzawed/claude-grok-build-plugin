---
description: Sign in to Grok (headless device-code flow)
---

Call `grok_cli` with `args: ["login", "--device-auth"]`. Relay `stdoutTail`/`stderrTail`
verbatim — it contains the device-code URL and code the user must open in a browser to
authorize. (Interactive browser login without `--device-auth` cannot run here; use the
terminal for that.)
