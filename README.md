# claude-grok-build-plugin

**English** · [한국어](README.ko.md)

A Claude Code plugin — an MCP-server wrapper — that lets Claude delegate part of a
coding task to **[Grok Build](https://x.ai/cli)** (xAI's terminal coding agent) and
pull the results back into your session for review.

It's a bridge plugin in the same spirit as wrapping another terminal coding agent
(for example, OpenAI's Codex CLI): Claude stays the orchestrator while an external
agent handles delegated work. What's specific here is the worker — xAI's **Grok
Build** — and one hard constraint: work is billed through your **xAI subscription
(SuperGrok / X Premium+), not metered API usage**.

> **Status — design only.** This repository currently contains design specs under
> [`docs/`](docs/) and no code yet. Start from Phase 1 in
> [`docs/06-roadmap.md`](docs/06-roadmap.md).

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
                        └─ spawns `grok` CLI  (headless: -p, streaming-json;
                           │                    API keys stripped from env)
                           └─ authenticates via subscription session token
                              (~/.grok/auth.json)
  ◀── structured summary + diff for Claude to review ──┘
```

Full architecture: [`docs/01-architecture.md`](docs/01-architecture.md).

## Core constraint — subscription auth (read this first)

Authentication relies entirely on the subscription session created by `grok login`
(browser OAuth), **never an API key.** The `grok` CLI prioritizes `XAI_API_KEY` /
`GROK_CODE_XAI_API_KEY` over the session token, so a single stray key in the
environment silently reroutes billing to metered API. The MCP server is therefore
**specified to strip those variables from the environment before spawning `grok`**,
and must never store, log, or read your credentials — this is the plugin's design
intent, not yet-shipped behavior (no code exists yet).

Rationale and verification checklist: [`docs/02-auth-strategy.md`](docs/02-auth-strategy.md).

## Folder structure

```
claude-grok-build-plugin/
├── README.md         # this file (English, default)
├── README.ko.md      # Korean
├── CLAUDE.md         # project context auto-loaded by Claude Code
├── LICENSE           # MIT
├── docs/             # design specs (finalize before implementing)
│   ├── 01-architecture.md
│   ├── 02-auth-strategy.md
│   ├── 03-plugin-spec.md
│   ├── 04-mcp-server-spec.md
│   ├── 05-routing-policy.md
│   └── 06-roadmap.md
├── .claude-plugin/plugin.json   # (created during implementation)
├── .mcp.json                    # (created during implementation)
├── mcp-server/                  # (created during implementation)
├── commands/                    # (created during implementation)
└── hooks/                       # (created during implementation)
```

> Only the design docs exist today. Fill in real code starting from Phase 1 of
> [`docs/06-roadmap.md`](docs/06-roadmap.md).

## Prerequisites (you do these yourself)

The plugin never logs in for you — `grok login` needs a browser and stays a manual,
one-time step.

```bash
# 1. Install the Grok Build CLI
curl -fsSL https://x.ai/cli/install.sh | bash

# 2. Log in with your subscription account (browser OAuth)
grok login

# 3. Verify login + subscription auth
grok --no-auto-update -p "Say ok."
```

## Reading order

1. [`docs/01-architecture.md`](docs/01-architecture.md) — the big picture
2. [`docs/02-auth-strategy.md`](docs/02-auth-strategy.md) — the most important constraint
3. [`docs/03-plugin-spec.md`](docs/03-plugin-spec.md), [`docs/04-mcp-server-spec.md`](docs/04-mcp-server-spec.md) — the files you'll actually build
4. [`docs/05-routing-policy.md`](docs/05-routing-policy.md) — when to delegate
5. [`docs/06-roadmap.md`](docs/06-roadmap.md) — implementation order

## License

[MIT](LICENSE) © 2026 xzawed
