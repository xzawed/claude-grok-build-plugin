---
description: Sign out of Grok and clear cached credentials
---

⚠️ **This is one-way from here.** Signing out clears the session token, and `/grok:login` cannot
sign back in — interactive login is refused by design (a buffered spawn cannot surface the
browser/device-code flow in time), so the only way back is `grok login` in a real terminal.
Until they do that, every delegation is denied.

**Ask first.** Say what will be lost and confirm the user wants it, in this turn, before calling
anything. Do not run logout as a step inside some larger task, and never to "reset" a problem —
if auth looks broken, `/grok:status` says what is actually wrong.

Once confirmed, call `grok_cli` with `args: ["logout"]`. Present `stdoutTail`; on error show
`stderrTail`. Then tell them plainly that credentials were cleared and that the way back is
`grok login` in their terminal.
