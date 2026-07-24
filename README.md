# Grok Build for Claude Code

**English** · [한국어](README.ko.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) ![Tests](https://img.shields.io/badge/tests-150%20passing-brightgreen.svg) ![TypeScript](https://img.shields.io/badge/TypeScript-ESM-3178C6.svg) ![Status](https://img.shields.io/badge/status-Phases%201--3%20complete-success.svg)

> A Claude Code plugin that lets Claude delegate coding work to **[Grok Build](https://x.ai/cli)** (xAI's terminal coding agent) and pull the diff back for review — billed through your **xAI subscription**, not metered API.

**What we're building:** help developers **use Grok well**, **feel how strong Grok is** at coding, and enjoy a **Claude ↔ Grok collaboration** (Claude orchestrates, Grok executes, you own the quality gate). Product north star: [`docs/00-product-vision.md`](docs/00-product-vision.md).

Claude stays the orchestrator; Grok Build is the worker. Same idea as wrapping any external terminal agent (e.g. OpenAI's Codex CLI) — what's specific here is the xAI worker and a subscription-first billing model. (Repo: `claude-grok-build-plugin`. Phases 1–3 complete; experience work and Phase 4 remain — see the [roadmap](docs/06-roadmap.md).)

## ⚡ Quick start

Two parts: a one-time **CLI install** (the only OS-specific step), then the **plugin install**, which you type inside Claude Code and is identical on every OS.

### 1. Install the Grok Build CLI (one-time) — pick your environment

- **macOS / Linux** — Terminal (bash, zsh, any shell):
  ```bash
  curl -fsSL https://x.ai/cli/install.sh | bash
  ```
- **Windows — PowerShell** (e.g. a Windows Terminal tab):
  ```powershell
  irm https://x.ai/cli/install.ps1 | iex
  ```
- **Windows — WSL** (Ubuntu, etc.): run the macOS/Linux command *inside* your WSL shell.

> Windows **Command Prompt (`cmd.exe`) is not supported** by either installer — use PowerShell or WSL. Don't mix the two: a WSL install isn't visible to native Windows and vice versa, so pick one path and run Claude Code on the same side.

### 2. Log in and smoke-test (browser OAuth, one-time) — same on every OS

```bash
grok login
grok --no-auto-update -p "Say ok."
```

> Needs an active **SuperGrok / X Premium+** subscription (or an API key for [API mode](#auth-modes)). The plugin never logs in or stores a key for you.

### 3. Install the plugin — inside Claude Code

These are **Claude Code prompts, not terminal commands**, and are identical on every OS and terminal:

```
/plugin marketplace add xzawed/claude-grok-build-plugin
/plugin install grok@grok-marketplace
/reload-plugins
/grok:setup
```

`/grok:setup` confirms you're ready.

## What it is

- **Parallelism.** Grok Build runs up to 8 subagents in parallel with git-worktree isolation — migrations, test backfills, and boilerplate finish faster than Claude alone.
- **Subscription, not metering.** If you pay for SuperGrok / X Premium+, delegated work runs *inside your plan* instead of at metered API rates.
- **Conventions carry over.** Grok Build reads your existing `CLAUDE.md` / `AGENTS.md` and `.claude/` config (skills, agents, MCP, hooks) with no extra setup.

Under the hood, `mcp-server/` (TypeScript, ESM) ships eight MCP tools over stdio — auth, delegate, plan, verify, usage (insights), worktree lifecycle, **route** (recommend only), and cli — plus a PreToolUse auth-check hook. 150 unit tests; prebuilt bundles are committed.

## ⚠️ Billing safety — the one thing to know

The `grok` CLI **prioritizes `XAI_API_KEY` / `GROK_CODE_XAI_API_KEY` over the session token**, so one stray key in your environment can silently reroute billing to metered API. In **subscription mode (the default)**, the server strips those variables before spawning `grok`, so a key in your shell profile never leaks into a delegation. Every `grok_build_delegate` response reports the `mode` and `billing` it actually ran under. The server never stores, logs, or reads your credentials — it only checks whether they're present.

**Headless edits need `--always-approve`.** Delegation always passes it (without it, headless `grok` ends with `stopReason: "Cancelled"` and makes *no* edits). That auto-approves **all** of grok's tool use — shell commands, deletions, installs, network, git — not just file edits, and non-file side effects don't show up in the `filesChanged` diff. So `grok` edits directly in the target `cwd` with **no auto-commit** (you review before committing), and for riskier work prefer an isolated `--worktree` / `--sandbox`.

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

Doing nothing keeps the original subscription-only behavior.

<details>
<summary><b>API mode setup (opt-in, metered)</b></summary>

The mode is read from `GROK_BUILD_AUTH_MODE` in the environment that launches the MCP server. Two equivalent ways:

- **Process env (recommended)** — set it where Claude Code starts, so a plugin update can't overwrite it:
  ```bash
  export XAI_API_KEY="..."          # your own key; the plugin never issues or stores one
  export GROK_BUILD_AUTH_MODE=api
  ```
- **`.mcp.json` env block** — add an `env` to the `grok-build` entry (may be overwritten on a plugin update):
  ```json
  "grok-build": {
    "command": "node",
    "args": ["${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/index.js"],
    "env": { "GROK_BUILD_AUTH_MODE": "api" }
  }
  ```
</details>

## Commands

Namespaced `/grok:*` (Claude Code derives the prefix from the plugin name, `grok`).

| Command | What it does |
|---|---|
| `/grok:setup` | Verify grok install + login; first-success sample + next scenarios |
| `/grok:delegate "<task>"` | Delegate a task; grok edits in `cwd`, no auto-commit |
| `/grok:plan "<task>"` | Read-only plan preview (no edits) |
| `/grok:verify "<task>"` | Delegate + grok self-verification (`--check`) |
| `/grok:tests` | Preset: test backfill / expansion |
| `/grok:migrate` | Preset: mechanical multi-file migration |
| `/grok:boilerplate` | Preset: scaffold / boilerplate |
| `/grok:usage` | Usage summary + insights (success rate, subscription share) |
| `/grok:worktree` | List / diff / apply / remove isolation worktrees (no auto-commit) |
| `/grok:route` | Recommend Claude vs Grok (no execution, no billing) |
| `/grok:cli "<raw grok args>"` | Passthrough: any grok subcommand under the billing-safe env |

**Skill:** `grok-routing` (auto-loaded with the plugin) steers Claude to **propose** Grok on bulk/low-risk work and keep architecture/security in Claude.

Utility verbs (via `grok_cli`): `sessions`, `export`, `import`, `memory`, `inspect`, `models`, `mcp`, `worktree`, `login` (guides terminal login), `logout`, `update`, `version`, `trace`. Non-headless modes (`dashboard`, `agent`, `leader`, `completions`, `wrap`) and `login` are guarded — the tool returns a "run it in your terminal" message instead of hanging.

## How it fits together

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

Full architecture: [`docs/01-architecture.md`](docs/01-architecture.md).

## Verify your install

From inside Claude Code, after install + a one-time `grok login`:

1. **`/grok:setup`** → a "ready" report with your active `mode`; otherwise it tells you exactly what to run.
2. **`/grok:delegate "create a file hello.txt containing exactly: ok"`** (in a throwaway dir) → check `filesChanged` includes `hello.txt` and — the key check — **`billing: "subscription"`** (not `metered_api`). Nothing auto-commits; review the diff yourself.
3. **`/grok:plan "add input validation to the main function"`** → a plan summary, no changed files.
4. **`/grok:models` · `/grok:usage`** → `usage` shows the runs you just did, split by subscription vs metered.
5. **Auth hook** — if you're *not* logged in, `/grok:delegate` is blocked *before* it runs, with a "run `grok login`" message.

> ⚠️ The `/grok:*` invocation strings, marketplace schema, and scoped tool-name matcher aren't frozen across Claude Code versions. If `/grok:setup` isn't found after `/reload-plugins`, run `/help` for the actual form and see [`docs/03-plugin-spec.md`](docs/03-plugin-spec.md).

## Docs

0. [`00-product-vision.md`](docs/00-product-vision.md) — why this exists (use Grok well · feel Grok · Claude↔Grok collab)
1. [`01-architecture.md`](docs/01-architecture.md) — the big picture
2. [`02-auth-strategy.md`](docs/02-auth-strategy.md) — the two-track auth constraint (most important)
3. [`03-plugin-spec.md`](docs/03-plugin-spec.md) · [`04-mcp-server-spec.md`](docs/04-mcp-server-spec.md) — what makes up `mcp-server/`
4. [`05-routing-policy.md`](docs/05-routing-policy.md) — when to delegate
5. [`06-roadmap.md`](docs/06-roadmap.md) — implementation order and current status
6. [`07-orchestrator-integration.md`](docs/07-orchestrator-integration.md) — Task Manager ↔ route/delegate contract
7. [`specs/grok-cli-contract.md`](docs/specs/grok-cli-contract.md) — the verified `grok` CLI flags/output schema the implementation relies on

<details>
<summary><b>Folder structure</b></summary>

```
claude-grok-build-plugin/
├── README.md · README.ko.md   # this file (EN / KO)
├── CLAUDE.md                  # project context auto-loaded by Claude Code
├── LICENSE                    # MIT
├── docs/                      # design specs, kept in sync with the code
│   ├── 00-product-vision.md … 06-roadmap.md
│   └── specs/                 # dated design/verification specs (e.g. grok-cli-contract.md)
├── .claude-plugin/plugin.json        # plugin manifest (name: grok)
├── .claude-plugin/marketplace.json   # marketplace entry (grok-marketplace)
├── .mcp.json                         # MCP server registration
├── mcp-server/                       # TS MCP server + hook (ships prebuilt dist/index.js + dist/hook.js)
├── commands/                         # /grok:* verb commands (+ presets)
├── skills/grok-routing/              # when to delegate (end-user runtime)
└── hooks/                            # pre-delegate-auth-check PreToolUse hook
```

Everything above exists. Next: Phase 3.5 (collab experience) and Phase 4 (orchestrator) — see [`docs/06-roadmap.md`](docs/06-roadmap.md).
</details>

## License

[MIT](LICENSE) © 2026 xzawed
