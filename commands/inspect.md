---
description: Show the configuration Grok discovers for this directory
---

Call `grok_cli` with `args: ["inspect", "--json"]` (append any extra flags the user gave).

⚠️ **This output is large — measured ~81 KB on an ordinary machine, against a 4,000-character
tail.** When the result carries `stdoutTruncated: true`, `stdoutTail` is the LAST 4,000
characters of a much longer document (`stdoutTotalChars` gives the real size) and **will not
parse as JSON**. Do not present it as the parsed config, and do not guess at the parts you
cannot see.

- **Truncated** — say so, quote `stdoutTotalChars`, and summarise only what is legible in the
  tail. If the user needs a specific section, offer to run
  `grok_cli` with `args: ["inspect"]` (the plain form is smaller) or have them run
  `grok inspect --json > inspect.json` in their terminal and read the file.
- **Not truncated** — `stdoutTail` is the whole document; parse and present it.

On error show `stderrTail`. If `status` is `blocked`, relay the `message`.
