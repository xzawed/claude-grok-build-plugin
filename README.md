# claude-grok-build-plugin

**English** · [한국어](README.ko.md)

A Claude Code plugin — an MCP-server wrapper — that lets Claude delegate part of a
coding task to **[Grok Build](https://x.ai/cli)** (xAI's terminal coding agent) and
pull the results back into your session for review.

It's a bridge plugin in the same spirit as wrapping another terminal coding agent
(for example, OpenAI's Codex CLI): Claude stays the orchestrator while an external
agent handles delegated work. What's specific here is the worker — xAI's **Grok
Build** — and a two-track auth model: by default, work is billed through your
**xAI subscription (SuperGrok / X Premium+), not metered API usage**; an opt-in
mode supports metered API billing for users without a subscription. See
[Auth modes](#auth-modes) below.

> **Status — Phases 1–3 implemented, plus the Phase 2 `pre-delegate-auth-check`
> hook, grok `PATH` prepend, auth-expiry signal handling, and a Codex-style
> `/grok:*` command surface.** `mcp-server/` (TypeScript, ESM) implements six MCP
> tools over stdio — `grok_auth_check`, `grok_build_delegate` (with worktree/sandbox
> isolation), `grok_build_plan`, `grok_build_verify`, `grok_build_usage`, and
> `grok_cli` (an arbitrary, billing-safe grok subcommand) — with 109 passing unit
> tests, and a PreToolUse auth-check hook in `hooks/`. Install is a 4-step
> marketplace flow and commands are namespaced `/grok:*` (see [Install](#install)
> and [Commands](#commands)). `.claude-plugin/plugin.json`,
> `.claude-plugin/marketplace.json`, `.mcp.json`, and `commands/` also exist. See
> [`docs/06-roadmap.md`](docs/06-roadmap.md) for what's next (Phase 4).

## Why build this

- **Parallelism.** Grok Build runs up to 8 subagents in parallel with git-worktree
  isolation, so large, repetitive work — migrations, test backfills, boilerplate —
  can finish faster than Claude working alone.
- **Subscription, not metering.** If you already pay for SuperGrok / X Premium+, the
  whole point is to run that work *inside your subscription plan* instead of at
  metered API rates.
- **Conventions carry over.** Grok Build reads your existing `CLAUDE.md` / `AGENTS.md`
  and `.claude/` config (skills, agents, MCP, hooks) with no extra setup, so your
  project conventions apply to delegated work automatically.

## How it fits together

```
Claude Code (your session)
  └─ MCP tool call ─▶ grok-build MCP server (this plugin)
                        └─ spawns `grok` CLI  (headless: -p, --always-approve,
                           │                    --output-format json;
                           │                    env stripped or passed through
                           │                    depending on auth mode)
                           └─ authenticates via subscription session token
                              (~/.grok/auth.json) or an API key, per mode
  ◀── structured summary + diff for Claude to review ──┘
```

Full architecture: [`docs/01-architecture.md`](docs/01-architecture.md).

## Auth modes

Auth mode is chosen **once, at the server level**, via the `GROK_BUILD_AUTH_MODE`
environment variable in `.mcp.json` — there is no per-call override.

| | `subscription` (default) | `api` (opt-in) |
|---|---|---|
| Trigger | unset, or `GROK_BUILD_AUTH_MODE=subscription` | `GROK_BUILD_AUTH_MODE=api` |
| Env handling | `XAI_API_KEY` / `GROK_CODE_XAI_API_KEY` **stripped** before spawning `grok` | those keys **passed through** as-is |
| Auth source | `~/.grok/auth.json` session token (`grok login`) | the API key already in your environment |
| Billing | your xAI subscription (flat) | metered API |
| Response `billing` field | `"subscription"` | `"metered_api"` |

The default is `subscription`, so doing nothing preserves the original
subscription-only behavior. Every `grok_build_delegate` response reports the
`mode` and `billing` it actually ran under, so there's no ambiguity about how a
given call was charged.

## Core constraint — no accidental metered billing (read this first)

The `grok` CLI prioritizes `XAI_API_KEY` / `GROK_CODE_XAI_API_KEY` over the session
token, so a single stray key in the environment can silently reroute billing to
metered API. In **subscription mode** (the default), the MCP server strips those
variables from the environment before spawning `grok`, so credentials in your
shell profile never leak into a delegated call. In **API mode** (opt-in only), the
keys are intentionally passed through. The server never stores, logs, or reads
your credentials in either mode — it only checks whether they're present.

⚠️ **Safety model for headless edits:** delegation always passes `--always-approve`
— verified empirically, headless `grok` calls end with `stopReason: "Cancelled"`
and make **no edits at all** without it. So `grok` edits files directly in the
target `cwd` (or an isolated `--worktree`), with **no auto-commit** — Claude or a
human is expected to review the diff before committing anything.

> ⚠️ `--always-approve` auto-approves **all** of grok's tool use — shell commands,
> file deletions, package installs, network access, and git operations — not only
> file edits. Non-file side effects (e.g. a command that deletes untracked files or
> pushes) do **not** show up in the diff / `filesChanged` review, so only delegate
> to a `cwd` you trust grok to act in, and prefer an isolated `--worktree` /
> `--sandbox` for riskier tasks (opt-in `worktree` / `sandbox` isolation is
> available now — see [`docs/06-roadmap.md`](docs/06-roadmap.md)).

Rationale and verification checklist: [`docs/02-auth-strategy.md`](docs/02-auth-strategy.md).

## Folder structure

```
claude-grok-build-plugin/
├── README.md         # this file (English, default)
├── README.ko.md      # Korean
├── CLAUDE.md         # project context auto-loaded by Claude Code
├── LICENSE           # MIT
├── docs/             # design specs (kept in sync with the implementation)
│   ├── 01-architecture.md
│   ├── 02-auth-strategy.md
│   ├── 03-plugin-spec.md
│   ├── 04-mcp-server-spec.md
│   ├── 05-routing-policy.md
│   ├── 06-roadmap.md
│   └── specs/        # dated design/verification specs (e.g. grok-cli-contract.md)
├── .claude-plugin/plugin.json        # plugin manifest (name: grok)
├── .claude-plugin/marketplace.json   # marketplace entry (grok-marketplace)
├── .mcp.json                         # MCP server registration
├── mcp-server/                       # TypeScript MCP server + hook (src/, test/; ships prebuilt dist/index.js + dist/hook.js)
├── commands/                         # /grok:* verb commands (setup, delegate, plan, verify, usage, + utility verbs, cli)
└── hooks/                            # hooks.json → pre-delegate-auth-check PreToolUse hook
```

> Everything above exists. The only remaining Phase 2 item (auth-expiry signal
> anchoring) is a refinement, not a new component — see
> [`docs/06-roadmap.md`](docs/06-roadmap.md).

## Install

Install the plugin from the marketplace — 4 steps (mirrors the OpenAI codex-plugin
style):

```
/plugin marketplace add xzawed/claude-grok-build-plugin
/plugin install grok@grok-marketplace
/reload-plugins
/grok:setup
```

`/grok:setup` verifies the Grok Build CLI is installed and you're logged in, then
guides you through anything missing. The plugin never logs in for you, and never
generates or stores an API key for you — you install `grok` and run `grok login`
yourself:

**Subscription mode (default) — nothing else to set:**
```bash
# 1. Install the Grok Build CLI
curl -fsSL https://x.ai/cli/install.sh | bash

# 2. Log in with your subscription account (browser OAuth) — manual, one-time
grok login

# 3. Verify login + subscription auth
grok --no-auto-update -p "Say ok."
```

**API mode (opt-in, metered) — set the auth mode and export your key.** The mode is
read from `GROK_BUILD_AUTH_MODE` in the environment that launches the MCP server.
Two equivalent ways to set it:

- **Process env (recommended for marketplace installs)** — set it in the environment
  that starts Claude Code, so a plugin update can't overwrite it:
  ```bash
  export XAI_API_KEY="..."          # your own key; this plugin never issues or stores one
  export GROK_BUILD_AUTH_MODE=api
  ```
- **`.mcp.json` env block** — add an `env` to the `grok-build` server entry (note that
  editing the bundled `.mcp.json` may be overwritten on a plugin update):
  ```json
  "grok-build": {
    "command": "node",
    "args": ["${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/index.js"],
    "env": { "GROK_BUILD_AUTH_MODE": "api" }
  }
  ```

## Commands

Plugin commands are namespaced `/grok:*` (Claude Code derives the prefix from the
plugin name, `grok`).

| Command | What it does |
|---|---|
| `/grok:setup` | Verify grok install + login and guide setup (onboarding) |
| `/grok:delegate "<task>"` | Delegate a coding task; grok edits in `cwd`, no auto-commit |
| `/grok:plan "<task>"` | Read-only plan preview (no edits) |
| `/grok:verify "<task>"` | Delegate + grok self-verification (`--check`) |
| `/grok:usage` | Read-only delegation usage summary |
| `/grok:cli "<raw grok args>"` | Passthrough: run any grok subcommand under the billing-safe env |

Utility verbs (via the `grok_cli` tool): `/grok:sessions`, `/grok:export`,
`/grok:import`, `/grok:memory`, `/grok:inspect`, `/grok:models`, `/grok:mcp`,
`/grok:worktree`, `/grok:login` (headless device-auth), `/grok:logout`,
`/grok:update`, `/grok:version`, `/grok:trace`. Non-headless grok modes
(`dashboard`, `agent`, `leader`, `completions`, `wrap`) are guarded — the tool
returns a "run it in your terminal" message instead of hanging.

## Reading order

1. [`docs/01-architecture.md`](docs/01-architecture.md) — the big picture
2. [`docs/02-auth-strategy.md`](docs/02-auth-strategy.md) — the most important constraint (two-track auth)
3. [`docs/03-plugin-spec.md`](docs/03-plugin-spec.md), [`docs/04-mcp-server-spec.md`](docs/04-mcp-server-spec.md) — the files that make up `mcp-server/`
4. [`docs/05-routing-policy.md`](docs/05-routing-policy.md) — when to delegate
5. [`docs/06-roadmap.md`](docs/06-roadmap.md) — implementation order and current status
6. [`docs/specs/grok-cli-contract.md`](docs/specs/grok-cli-contract.md) — the verified `grok` CLI flags/output schema the implementation relies on

## License

[MIT](LICENSE) © 2026 xzawed
