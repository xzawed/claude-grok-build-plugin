---
description: Show the configuration Grok discovers for this directory
---

Call `grok_cli` with `args: ["inspect", "--json"]` (append any extra flags the user gave).
Present the parsed config from `stdoutTail`; on error show `stderrTail`. If `status` is
`blocked`, relay the `message`.
