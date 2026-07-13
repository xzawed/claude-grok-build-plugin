---
description: Verify Grok is installed and signed in; guide setup
---

Call `grok_auth_check`. If it returns `ok: true`, report the active `mode`
(subscription or api) and that Grok is ready to use.

If `ok: false`, show the `message` and guide the fix by `reason`:
- `grok_not_installed` → tell the user to install: `curl -fsSL https://x.ai/cli/install.sh | bash`
- `not_logged_in` → tell them to run `grok login` in their terminal (one-time browser OAuth)
- `no_api_key` → tell them to set `XAI_API_KEY` (they are in API mode)

Do not attempt to log in or install on the user's behalf.
