---
description: Why Grok has no session import (use /grok:sessions + /grok:resume)
---

Do **not** call `grok_cli` with `["import", ...]`. Grok Build CLI 1.0 has **no** `import`
subcommand — a leading `import` is grok's PROMPT, and the interactive UI that opens sends a bare
prompt to the model (measured for other words). The tool returns `blocked` if asked.

Tell the user: list sessions with `/grok:sessions` (`grok sessions list`) and continue
with `/grok:resume` / `grok_build_delegate` `resume`. There is no file-import path in
this plugin.
