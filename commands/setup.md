---
description: Verify Grok is installed and signed in; guide setup
---

Call `grok_auth_check`.

## If `ok: false`

Show the `message` and guide the fix by `reason`:

- `grok_not_installed` → follow the tool `message` (platform-aware). Install CLI:
  - macOS/Linux: `curl -fsSL https://x.ai/cli/install.sh | bash`
  - Windows PowerShell: `irm https://x.ai/cli/install.ps1 | iex`
  - Then open a **new** terminal / restart Claude Code so PATH picks up `~/.grok/bin`
- `not_logged_in` → run `grok login` in a terminal (one-time browser OAuth)
- `no_api_key` → set `XAI_API_KEY` (API mode)

Do not attempt to log in or install on the user's behalf.

## If `ok: true` — first success path

Report the active `mode` (`subscription` or `api`), expected **`billing`**, and
optional `serverVersion` (plugin MCP surface). Confirm Grok is ready.

Then guide a **short first win** (do not run destructive work):

1. **Optional sample** (throwaway dir or user-approved path):  
   `/grok:delegate` with prompt like: create `hello.txt` containing exactly `ok`  
   — or call `grok_build_delegate` with that prompt and absolute `cwd`.
2. After the run, highlight **`billing`**: users on SuperGrok / X Premium+ should see
   `"subscription"` (not `"metered_api"`). If they see metered unexpectedly, explain
   API keys can override session auth and point them at subscription mode docs.
3. Remind: **no auto-commit** — review `filesChanged` before committing.

### Next scenarios (where Grok shines)

Suggest trying one when relevant:

| Command | Use for |
|---|---|
| `/grok:tests` | Test backfill / expansion |
| `/grok:migrate` | Same pattern across many files |
| `/grok:boilerplate` | Scaffold / CRUD / DTO stubs |
| `/grok:plan` | Read-only approach preview |
| `/grok:verify` | Delegate + Grok self-check |

Claude should also **propose** Grok on fit tasks via the `grok-routing` skill without
waiting for a slash command.

If the user is new or asks what to do next, offer **`/grok:tour`** (15-minute guided first win)
and point to `docs/08-getting-started-with-grok.md` for the human map.
