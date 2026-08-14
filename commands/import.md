---
description: Import sessions into Grok
---

Do **not** call `grok_cli` with `["import", ...]`. Grok Build CLI 1.0 has **no** `import`
subcommand — a leading `import` is treated as a TUI prompt and would hang the headless
spawn. The tool returns `blocked` if asked.

Tell the user: list sessions with `/grok:sessions` (`grok sessions list`) and continue
with `/grok:resume` / `grok_build_delegate` `resume`. There is no file-import path in
this plugin.
