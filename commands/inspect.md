---
description: Show the configuration Grok discovers for this directory
---

Call `grok_cli` with `args: ["inspect", "--json"]` (append any extra flags the user gave).

⚠️ **This output is large — measured ~81 KB on an ordinary machine, against a 4,000-character
default.** For `inspect` (and `help`, `--help`, `-h`) the tool keeps the FIRST characters, not the
last, and reports `stdoutKept: "head"`. When the result carries `stdoutTruncated: true`,
`stdoutTail` is the FIRST 4,000 characters of a much longer document (`stdoutTotalChars` gives the
real size) and **will not parse as JSON**. Do not present it as the parsed config, and do not guess
at the parts you cannot see.

- **Truncated** — say so, quote `stdoutTotalChars`, and summarise only what is legible in the kept
  head. If the user needs the whole document, offer to call again with `max_chars: 100000` (the
  ceiling; ~81 KB fits, at that token cost). For a specific section, offer `grok_cli` with
  `args: ["inspect"]` (the plain form is smaller), or have them run
  `grok inspect --json > inspect.json` in their terminal and read the file.
- **Not truncated** — `stdoutTail` is the whole document; parse and present it. (If `stdoutCutShort` is
  `true`, the output may stop before its end — the run hit its time cap, or reading stopped while
  something grok started still held it: treat it as incomplete, like a truncated one.)

On error show `stderrTail`. If `status` is `blocked`, relay the `message`.
