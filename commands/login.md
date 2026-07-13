---
description: Sign in to Grok (guides the one-time terminal login)
---

Grok's login is interactive — browser OAuth blocks, and even `--device-auth` prints a
device-code URL and then blocks polling for authorization, so this environment can't
surface the URL in time. Tell the user to run login **in their own terminal** (one-time):

- Normal: `grok login`
- Headless/remote: `grok login --device-auth` (then open the printed URL + enter the code)

After they finish, they can confirm with `/grok:setup`. Do NOT call `grok_cli` for login —
it will be refused (`status: "blocked"`) for this reason.
