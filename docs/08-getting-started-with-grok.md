# 08. Getting started with Grok (via this plugin)

This is the **human-facing starting map**.  
Technical specs live in `docs/01`–`07`. Product why: `docs/00-product-vision.md`.

## Who this is for

You already use **Claude Code**, and you either:

- pay for **SuperGrok / X Premium+** and want that subscription to do real coding work, or  
- have an **xAI API key** and want a safer headless path into Grok Build.

You are **not** trying to replace Claude. You want Claude to **direct** and Grok to **execute** the right slices.

## What “using Grok well” means here

| Do this | Not that |
|---|---|
| Hand Grok **bulk / repetitive / low-risk / narrow** work | Dump architecture or security on Grok |
| Always read **`billing`** on every run | Read it as a measured charge — it is the configured `GROK_BUILD_AUTH_MODE` |
| Review **`filesChanged`**, then **you** commit | Expect auto-commit / auto-PR |
| Use **`worktree: true`** when blast radius is high | Let a risky edit land unreviewed in `cwd` |
| Prefer **plan → execute** when unsure | Thrash re-delegations |

## The 15-minute path

### 0. Prerequisites

1. Grok CLI installed (`install.sh` / `install.ps1`).
2. `grok login` (or API mode + `XAI_API_KEY`).
3. This plugin installed in Claude Code (`/plugin …` → `/grok:setup`).

### 1. Prove the bridge (`/grok:setup`)

- Expect `mode: subscription` (or `api` if you chose metered).
- If not ready, follow the exact install/login message — do not improvise.

### 2. First win (billing check)

In a **throwaway** folder:

```
/grok:delegate create a file hello.txt containing exactly: ok
```

Success criteria:

- `filesChanged` includes `hello.txt`
- **`billing: "subscription"`** if you intended subscription (not `metered_api`)
- Nothing was committed for you

If `billing` is not what you intended, check `GROK_BUILD_AUTH_MODE` on the MCP server — that
setting alone decides the tag. In subscription mode the server strips `XAI_API_KEY` /
`GROK_CODE_XAI_API_KEY` before spawning grok, so a shell key cannot flip it. See
`docs/02-auth-strategy.md`.

### 3. Feel a real Grok strength

Pick one that matches your repo:

| Command | When it shines |
|---|---|
| `/grok:tests` | Missing tests, same patterns, volume |
| `/grok:migrate` | Mechanical rename / import / API shape sweep |
| `/grok:boilerplate` | CRUD / DTO / handler scaffolding |
| `/grok:plan` then `/grok:delegate` | You want approach first |
| `/grok:verify` | You want Grok to self-check after edits |

Optional power: `worktree: true`, `sandbox: "workspace"` (Linux/macOS kernel enforce; Windows: don’t assume). `--best-of-n` was removed in CLI 1.0.

### 4. Make collaboration habitual

- Ask Claude: *“Should Grok take this?”* → skill `grok-routing` + `/grok:route` (follow **`nextAction`**).
- Anytime: **`/grok:status`** — ready?, billing, usage headline, last session, next steps.
- After runs: **`/grok:review`** (diff gate) · `/grok:usage` · **`/grok:resume`** when `lastSession.sessionId` exists.
- Risky change: isolate → `/grok:worktree` list/diff/apply/remove.

## Mental model (one diagram)

```
You decide intent & quality gate
        │
        ▼
Claude  ──route / plan──▶  (optional) Grok Build worker
        │                        │
        │◄── summary + files ────┘
        ▼
You review diff → commit
```

## Why this plugin is the “starting point”

Raw `grok` in a terminal is powerful but easy to misuse: wrong billing, hanging auth, silent over-edits, no Claude review loop.

This plugin is intentionally a **on-ramp**:

1. **Subscription-safe by default** — API keys stripped unless you opt into API mode.  
2. **Claude stays pilot** — routing skill + `/grok:route` so Grok is used where it shines.  
3. **Reviewable outcomes** — structured JSON, `filesChanged` delta, worktree lifecycle.  
4. **Recipes, not raw flags** — presets for the jobs that make people say “Grok is good.”

Once the path is muscle memory, you can still use full Grok CLI power via `/grok:cli` under the same billing-safe env.

## Troubleshooting (first week)

| Symptom | Likely fix |
|---|---|
| Plugin commands missing | `/reload-plugins`, `/help`, reinstall marketplace plugin |
| `grok` not found | Install CLI; restart Claude Code; Windows: PowerShell install, not cmd |
| Not signed in / auth_error | `grok login` in a real terminal |
| `billing: metered_api` unexpectedly | The server is in `api` mode — unset `GROK_BUILD_AUTH_MODE` (default is subscription) |
| Huge / scary diff | Next time `worktree: true`; use `/grok:worktree` to apply/remove |
| Timeout | Narrow prompt; raise `timeout_ms` |

## Next depth (optional)

- Orchestrator / multi-agent systems: `docs/07-orchestrator-integration.md`
- Sandbox profiles: `docs/specs/2026-07-25-sandbox-profiles.md`
- CLI contract (engineers): `docs/specs/grok-cli-contract.md`
