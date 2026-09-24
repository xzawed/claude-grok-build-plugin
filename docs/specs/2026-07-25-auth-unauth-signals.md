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
| Rejected session: 401 `Invalid or expired credentials` (contract §7 C) | `parseGrokResult` + `looksLikeAuthFailure` | `auth_error` |
| Parse fail + auth keywords | `looksLikeAuthFailure` | `auth_error` |
| Ordinary errors / 403 in code output | (no match) | `grok_error` / `timeout` |

## Limitation

Keyring may still authenticate when only `auth.json` is removed in the real home — so the
HOME/USERPROFILE juggling described above does **not** isolate grok. `GROK_HOME` is the only
switch that relocates grok state wholesale, and there is **no fallback** under it: measured on
1.0.13 (2026-09-03), `GROK_HOME=<tmp> grok models` prints "You are not authenticated." while a
valid `~/.grok/auth.json` sits untouched. See `grok-cli-contract.md` §8.

> **Corrected 2026-09-24 (grok 1.0.41, win32):** "the only switch" overstated it. With `GROK_HOME`
> unset, `USERPROFILE` does move grok's home (`HOME` does not) — the 1.0.13 commands behind the old
> sentence only ever changed `HOME`. Isolation still uses `GROK_HOME`: it is explicit, wins over both,
> and does not depend on the platform. A relative `GROK_HOME` resolves against grok's working folder.
> Details: contract §8.

Isolated-home probe is the reliable automation path without destroying credentials. Note what
it can and cannot reproduce: it makes a session **absent**, never **expired**. Expiry has its
own probe: `npm run probe:expired` writes a *rejected* auth.json into an isolated `GROK_HOME`
(measured 2026-09-05 on 1.0.13 — exit 1, first output in 10-20s, envelope either `Not signed in.`
or a 401 `Invalid or expired credentials`; grok **discards** the session, it does not wait).
See `grok-cli-contract.md` §7 C.
