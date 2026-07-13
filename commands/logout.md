---
description: Sign out of Grok and clear cached credentials
---

Call `grok_cli` with `args: ["logout"]`. Present `stdoutTail`; on error show `stderrTail`.
Confirm to the user that Grok credentials were cleared (they will need `/grok:login` again).
