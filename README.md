# Grok Build for Claude Code

**English** · [한국어](README.ko.md)

[![CI](https://github.com/xzawed/claude-grok-build-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/xzawed/claude-grok-build-plugin/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-ESM-3178C6.svg)

> A **Claude Code plugin** that lets Claude hand coding work to the
> **[Grok Build](https://x.ai/cli)** CLI — billed to your **xAI subscription**, not silently to a
> metered API.
>
> Claude directs, Grok executes in your working tree, and you keep the quality gate: nothing is
> committed for you.

**Goals:** use Grok well · see where Grok is strong · Claude ↔ Grok collaboration —
[`docs/00-product-vision.md`](docs/00-product-vision.md).
Reading as a human? Start at
[`docs/08-getting-started-with-grok.md`](docs/08-getting-started-with-grok.md).

After install, run **`/grok:tour`** — a 15-minute guided first win, billing check included.

## Quick start

Steps 1–2 run once in your terminal, and only the install command differs per OS. Step 3 runs
inside Claude Code and is identical everywhere.

### 1. Install the Grok Build CLI (one-time)

- **macOS / Linux** — any shell (bash, zsh):
  ```bash
  curl -fsSL https://x.ai/cli/install.sh | bash
  ```
- **Windows — PowerShell** (e.g. a Windows Terminal tab):
  ```powershell
  irm https://x.ai/cli/install.ps1 | iex
  ```
- **Windows — WSL** (Ubuntu, etc.): run the macOS/Linux command *inside* your WSL shell.

> [!IMPORTANT]
> Windows Command Prompt (`cmd.exe`) is not supported by either installer — use PowerShell or
> WSL. Pick one side and run Claude Code on it too: a WSL install is invisible to native Windows,
> and vice versa.

### 2. Log in and smoke-test (browser OAuth, one-time)

```bash
grok login
grok --no-auto-update -p "Say ok."
```

This needs an active **SuperGrok / X Premium+** subscription — or an xAI API key if you want
[metered API mode](#auth-modes). The plugin never logs in for you and never stores a key.

### 3. Install the plugin — inside Claude Code

These are **Claude Code prompts, not terminal commands**, and are identical on every OS:

```
/plugin marketplace add xzawed/claude-grok-build-plugin
/plugin install grok@grok-marketplace
/reload-plugins
/grok:setup
```

`/grok:setup` confirms you're ready. Then **`/grok:tour`** walks auth → route demo → tiny sample
→ what to try next.

## What it is

- **When to delegate, not just how.** Claude-side routing — `/grok:route` and the `grok-routing`
  skill — proposes Grok for bulk, low-risk work and keeps architecture and security in Claude.
- **Isolation for volume work.** A delegation can run in a dedicated git worktree, so a
  migration, test backfill, or boilerplate pass touches nothing in your checkout until you apply
  it. Grok Build also spawns subagents of its own during a run.
- **Subscription, not metering.** By default the server strips `XAI_API_KEY` /
  `GROK_CODE_XAI_API_KEY` before it spawns `grok`, so delegated work runs inside your SuperGrok /
  X Premium+ plan instead of at metered API rates.
- **Conventions carry over.** Grok Build reads your existing `CLAUDE.md` / `AGENTS.md` and
  `.claude/` config (skills, agents, MCP, hooks) with no extra setup.

The MCP server and its hook ship prebuilt in `mcp-server/dist/`, so installing the plugin needs no
build step.

## When to delegate — and when not

| Hand to Grok | Keep in Claude |
|---|---|
| Bulk, repetitive edits — one pattern across many files, renames, import fixes | Architecture and design decisions |
| Low-risk volume — test backfill, docs sync, boilerplate | Security and compliance — auth, permissions, crypto, regulated domains |
| Narrow, independent scope — one module, clear acceptance criteria | Anything needing whole-monorepo context |
| Exploratory prototypes you were going to review anyway | The final review and quality gate |

`/grok:route` applies this for you and returns a `nextAction` — it never executes anything and
never bills. Full criteria: [`docs/05-routing-policy.md`](docs/05-routing-policy.md).

## Billing and approval safety

> [!CAUTION]
> In **subscription mode — the default —** the server strips `XAI_API_KEY` and
> `GROK_CODE_XAI_API_KEY` before spawning `grok`, so a key in your shell profile can never be
> the credential a delegation runs on. That is a guarantee about what the process is *handed*,
> not a claim about which credential the CLI would have picked: measured on grok 1.0.13, a live
> session token wins and the env key is not attempted. It becomes the fallback the moment the
> session is missing or expired — which is exactly when a run that began as "subscription" could
> quietly bill metered instead. Stripping it makes that run fail loudly rather than silently
> switch who pays. See [`docs/specs/grok-cli-contract.md`](docs/specs/grok-cli-contract.md) §10.

- Every `grok_build_delegate` response reports the `mode` it was configured with and the `billing`
  that mode implies — a tag derived from `GROK_BUILD_AUTH_MODE`, not an observation of what xAI
  actually charged (`docs/specs/grok-cli-contract.md` §2).
- The server never stores, logs, or reads your credentials — it only checks whether they're
  present.

> [!WARNING]
> **Every delegation auto-approves all of grok's tool use** — shell commands, deletions,
> installs, network, git — not just file edits, and non-file side effects never show up in the
> `filesChanged` diff. Headless `grok` cannot edit without `--always-approve` (without it the run
> ends with `stopReason: "Cancelled"` and changes nothing), so the plugin always passes it.
>
> `grok` edits directly in the target `cwd` and **nothing is auto-committed** — you review first.
> For riskier work, isolate the run with `--worktree` / `--sandbox`.

Full rationale and verification checklist: [`docs/02-auth-strategy.md`](docs/02-auth-strategy.md).

## Auth modes

Chosen **once, at the server level**, via `GROK_BUILD_AUTH_MODE` — there is no per-call override.

| | `subscription` (default) | `api` (opt-in) |
|---|---|---|
| Trigger | unset, or `=subscription` | `GROK_BUILD_AUTH_MODE=api` |
| Env handling | API keys **stripped** before spawn | keys **passed through** |
| Auth source | `~/.grok/auth.json` (`grok login`) | the API key in your environment |
| Billing | xAI subscription (flat) | metered API |
| Response `billing` | `"subscription"` | `"metered_api"` |

If you never set `GROK_BUILD_AUTH_MODE`, every delegation runs in subscription mode.

<details>
<summary><b>API mode setup (opt-in, metered)</b></summary>

The mode is read from `GROK_BUILD_AUTH_MODE` in the environment that launches the MCP server.
Two equivalent ways:

- **Process env (recommended)** — set it where Claude Code starts, so a plugin update can't
  overwrite it:
  ```bash
  export XAI_API_KEY="..."          # your own key; the plugin never issues or stores one
  export GROK_BUILD_AUTH_MODE=api
  ```
- **`.mcp.json` env block** — add an `env` to the `grok-build` entry (may be overwritten on a
  plugin update):
  ```json
  "grok-build": {
    "command": "node",
    "args": ["${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/index.js"],
    "env": { "GROK_BUILD_AUTH_MODE": "api" }
  }
  ```
</details>

## Commands

The plugin ships 27 `/grok:*` commands — Claude Code derives the prefix from the plugin name,
`grok`. The 15 below are the ones you type day to day; the other 12 wrap grok's own CLI and are
collapsed under the tables.

**Everyday loop**

| Command | What it does |
|---|---|
| `/grok:route` | Recommend Claude vs Grok + **`nextAction`** (no execution, no billing) |
| `/grok:plan "<task>"` | Read-only plan preview (no edits) |
| `/grok:delegate "<task>"` | Delegate a task; grok edits in `cwd`, no auto-commit |
| `/grok:verify "<task>"` | Delegate + grok self-verification (prompt checklist) |
| `/grok:review` | Post-edit quality gate (diff + billing; never auto-commit) |
| `/grok:worktree` | List / diff / apply / remove / prune isolation worktrees (no auto-commit) |
| `/grok:resume` | Continue a prior Grok session (`lastSession.sessionId`) |
| `/grok:usage` | Usage summary + insights (success rate, subscription share) |

**Setup, presets, passthrough**

| Command | What it does |
|---|---|
| `/grok:setup` | Verify grok install + login; first-success sample + next scenarios |
| `/grok:status` | **Dashboard** — ready?, billing, usage, last session, next steps |
| `/grok:tour` | **15-minute guided tour** — auth, route demo, tiny first win, next recipes |
| `/grok:tests` | Preset: test backfill / expansion |
| `/grok:migrate` | Preset: mechanical multi-file migration |
| `/grok:boilerplate` | Preset: scaffold / boilerplate |
| `/grok:cli "<raw grok args>"` | Passthrough: any grok subcommand under the billing-safe env |

<details>
<summary><b>The other 12 — grok's own CLI verbs</b></summary>

| Command | What it does |
|---|---|
| `/grok:sessions` | List, search, or delete Grok sessions (no restore — use `/grok:resume`) |
| `/grok:export` | Export a Grok session transcript as Markdown |
| `/grok:memory` | Manage Grok cross-session memory |
| `/grok:inspect` | Show the configuration Grok discovers for this directory |
| `/grok:models` | List available Grok models |
| `/grok:mcp` | Manage Grok's MCP server configurations |
| `/grok:login` | Guide the one-time terminal login (never runs it for you) |
| `/grok:logout` | Sign out and clear cached credentials |
| `/grok:update` | Check for or install Grok updates |
| `/grok:version` | Show the installed Grok version |
| `/grok:trace` | Export or upload Grok session trace data |
| `/grok:import` | Returns `blocked` — not a Grok CLI 1.0 subcommand; use `/grok:sessions` + `/grok:resume` |

Two things worth knowing about this group:

- `/grok:worktree` is **not** one of them. It is backed by the `grok_build_worktree` tool, a
  different tracker from grok's own `worktree` subcommand.
- `/grok:login` and `/grok:import` never spawn grok: the first hands you the terminal command,
  the second reports `blocked`. The same guard covers grok's non-headless modes (`dashboard`,
  `agent`, `leader`, `completions`, `wrap`), which would otherwise leave the session hanging.
</details>

**Skills and agent (auto-discovered):**

- `grok-routing` — propose Grok on bulk/low-risk work; keep architecture/security in Claude
- `grok-first-mile` — onboarding / "what do I try first?"
- `grok-worker` agent — execute volume work via MCP tools, Claude reviews

## How a delegation runs

```
Claude Code (your session)
  └─ MCP tool call ─▶ grok-build MCP server (this plugin)
                        └─ spawns `grok` CLI  (headless: -p, --always-approve,
                           │                    --output-format json; env stripped
                           │                    or passed through, per auth mode)
                           └─ auth via subscription session token
                              (~/.grok/auth.json) or an API key, per mode
  ◀── structured summary + diff for Claude to review ──┘
```

`mcp-server/` (TypeScript, ESM) ships nine MCP tools over stdio — auth, **status**, delegate,
plan, verify, usage (insights), worktree lifecycle, **route** (recommend only), and cli — plus a
PreToolUse auth-check hook.

Full architecture: [`docs/01-architecture.md`](docs/01-architecture.md).

## Verify install and billing

From inside Claude Code, after install + a one-time `grok login`:

1. **`/grok:status`** (or `/grok:setup`) → `ready`, `mode`, expected `billing`, `serverVersion`.
2. **`/grok:delegate "create a file hello.txt containing exactly: ok"`** in a throwaway directory
   — grok edits there for real → confirm `filesChanged` lists `hello.txt`, then check the field
   that matters: **`billing: "subscription"`**, not `metered_api`.
   - Nothing was committed. Review the diff with **`/grok:review`**.
3. **`/grok:plan "add input validation to the main function"`** → a plan summary, no changed
   files.
4. **`/grok:route`** → a `nextAction` recommendation; **`/grok:usage`** → history plus the
   `lastSession` that **`/grok:resume`** continues.

## Troubleshooting

| Symptom | What it means | Fix |
|---|---|---|
| `/grok:setup` isn't found after `/reload-plugins` | The `/grok:*` invocation strings and the marketplace schema aren't frozen across Claude Code versions | Run `/help` for the exact form, then see [`docs/03-plugin-spec.md`](docs/03-plugin-spec.md) |
| `/grok:delegate` is blocked before it runs, telling you to run `grok login` | You aren't logged in. The PreToolUse hook and the server's own auth check both gate this; under the default (unset) mode it is the server that stops you | Run `grok login` in your terminal, then retry |
| `/grok:status` reports **`billingMismatch`** | The server is in subscription mode, but past delegations were recorded as metered. Those ran under `api` mode — it is never evidence of a leaked key, since subscription mode strips them | Sort the billing path out — check `GROK_BUILD_AUTH_MODE` — before delegating again |
| `serverVersion` still shows the old version after a plugin update | The MCP server process predates the update | Restart Claude Code, then re-check `/grok:status` |

## Docs

- [`00-product-vision.md`](docs/00-product-vision.md) — why this exists
  (use Grok well · feel Grok · Claude↔Grok collab)
- [`08-getting-started-with-grok.md`](docs/08-getting-started-with-grok.md) —
  **start here as a human** (15-minute path + recipes)
- [`01-architecture.md`](docs/01-architecture.md) — the big picture
- [`02-auth-strategy.md`](docs/02-auth-strategy.md) — the two-track auth constraint
  (most important)
- [`03-plugin-spec.md`](docs/03-plugin-spec.md) ·
  [`04-mcp-server-spec.md`](docs/04-mcp-server-spec.md) — what makes up `mcp-server/`
- [`05-routing-policy.md`](docs/05-routing-policy.md) — when to delegate
- [`06-roadmap.md`](docs/06-roadmap.md) — implementation order and current status
- [`07-orchestrator-integration.md`](docs/07-orchestrator-integration.md) —
  Task Manager ↔ route/`nextAction` contract
  - example: [`examples/orchestrator-consumer.md`](examples/orchestrator-consumer.md)
- [`09-scope-and-residuals.md`](docs/09-scope-and-residuals.md) — what's finished in this repo,
  and what deliberately lives outside it
- [`specs/grok-cli-contract.md`](docs/specs/grok-cli-contract.md) — the `grok` CLI flags and
  output schema this plugin was built against, each one measured

<details>
<summary><b>Folder structure</b></summary>

```
claude-grok-build-plugin/
├── README.md · README.ko.md   # this file (EN / KO)
├── CLAUDE.md                  # project context auto-loaded by Claude Code
├── CHANGELOG.md               # release history
├── CONTRIBUTING.md            # branch/PR rules, dist + version rules
├── LICENSE                    # MIT
├── docs/                      # design specs, kept in sync with the code
│   ├── 00-product-vision.md … 09-scope-and-residuals.md
│   ├── specs/                 # dated design/verification specs (e.g. grok-cli-contract.md)
│   └── plans/ · releases/     # implementation plans, per-version release notes
├── examples/                  # orchestrator consumer kit
├── .claude-plugin/plugin.json        # plugin manifest (name: grok)
├── .claude-plugin/marketplace.json   # marketplace entry (grok-marketplace)
├── .mcp.json                         # MCP server registration
├── mcp-server/                       # TS MCP server + hook (ships prebuilt dist/index.js + dist/hook.js)
├── commands/                         # /grok:* (+ tour, presets)
├── skills/                           # grok-routing, grok-first-mile
├── agents/grok-worker.md             # volume-work subagent
├── hooks/                            # pre-delegate-auth-check PreToolUse hook
└── .github/workflows/                # CI (ubuntu + windows)
```

**In-repo scope is complete.** External Task Manager wiring lives in consumer repos; Claude Code
GUI clicks are a manual release checklist; ACP is deferred.

See [`docs/09-scope-and-residuals.md`](docs/09-scope-and-residuals.md) and
[`docs/06-roadmap.md`](docs/06-roadmap.md).
</details>

## License

[MIT](LICENSE) © 2026 xzawed
