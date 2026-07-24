# Unauthenticated / expired session signals (2026-07-25)

## Live probe (this machine)

Method: empty temp `USERPROFILE`/`HOME` + clear `XAI_API_KEY` / `GROK_CODE_XAI_API_KEY`
(does **not** move real `~/.grok/auth.json`).

```
cd mcp-server && npm run probe:unauth
```

**Observed (Windows, grok on PATH):**

| Field | Value |
|---|---|
| exit | 1 |
| timed out | no (~immediate) |
| stdout | `{"type":"error","message":"Not signed in... grok login --device-code..."}` |
| stderr | `Error: Not signed in...` |

## Classification in the plugin

| Path | Detector | Result |
|---|---|---|
| Timeout + device URL / Waiting… | `DEVICE_AUTH_SIGNALS` via `looksLikeAuthFailure` | `auth_error` |
| Immediate JSON `type:error` + Not signed in | `parseGrokResult` + `looksLikeAuthFailure` | `auth_error` |
| Parse fail + auth keywords | `looksLikeAuthFailure` | `auth_error` |
| Ordinary errors / 403 in code output | (no match) | `grok_error` / `timeout` |

## Limitation

Keyring may still authenticate when only `auth.json` is removed in the real home.
Isolated-home probe is the reliable automation path without destroying credentials.
