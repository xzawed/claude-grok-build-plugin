---
name: grok-routing
description: >
  When to delegate coding work to Grok Build vs handle it in Claude. Use whenever
  the user asks for bulk edits, test backfill, migrations, boilerplate, exploratory
  prototypes, or whether to use /grok:delegate — and when reviewing whether a task
  is safe to hand to Grok.
---

# Grok routing (Claude orchestrates, Grok executes)

You are in a session where the **grok** plugin can run Grok Build via MCP.
Product goal: help the user **use Grok well**, **feel Grok’s strength**, and enjoy
**Claude ↔ Grok collaboration** — not replace Claude.

## Default posture

When a task is a good fit for Grok, **propose delegation first** (brief why + tool),
then run it if the user agrees or already asked to use Grok. Do not dump every
coding task on Grok.

## Delegate to Grok when

| Fit | Examples |
|---|---|
| Bulk / repetitive | Same pattern across many files, renames, import fixes |
| Low-risk volume | Test backfill, docs sync, boilerplate CRUD/DTO/scaffold |
| Narrow independent scope | Single module, clear acceptance criteria, little monorepo coupling |
| Exploratory prototype | Try an approach fast; user will review |

**Tools:**

- **Route first (no side effects):** `grok_build_route` or `/grok:route` — structured
  LOW/MEDIUM/HIGH recommendation before any delegate
- Plan first (no edits): `grok_build_plan` or `/grok:plan`
- Execute: `grok_build_delegate` or `/grok:delegate`
- Execute + self-check: `grok_build_verify` or `/grok:verify`
- Scenario presets: `/grok:tests`, `/grok:migrate`, `/grok:boilerplate`
- Auth / ready: `grok_auth_check` or `/grok:setup`

Always pass absolute `cwd`. Prefer English prompts for the `prompt` field.

Optional tool fields (validated; bad values fail without running grok): `model`, `effort`,
`best_of_n` (2–4 only — raise `timeout_ms`), `resume` / `continue` (not both),
`sandbox` (`workspace` | `read-only` | `strict` | `devbox` | `off` — Linux/macOS kernel
enforce; Windows not assumed). Results may include `sessionId` for later `resume`.
`filesChanged` lists paths that became dirty *during* the run; use `worktree: true` on
already-dirty trees for full attribution.

## Keep in Claude (do not delegate)

- Architecture / design decisions, API shape trade-offs
- Security (auth, crypto, permissions), secrets, compliance / regulated domains
- Work needing whole monorepo or very large context
- Final code review and quality gate (you always review Grok’s diff)

## After every Grok run

1. Show `summary`, `filesChanged`, and especially **`billing`** (`subscription` vs `metered_api`).
2. **Review the diff yourself** before any commit. Never auto-commit; the server never commits.
3. Risky or large work: use `worktree: true` so changes land in an isolated worktree (`worktreePath`); review there before merge.
4. Partial failure still may list `filesChanged` — inspect before continuing.

## Auth failures

If tools fail with install/login messages, guide `/grok:setup` or the message’s commands.
Do not attempt `grok login` or install inside this session for the user.

## Cost note

Default mode is **subscription**. Do not thrash (no delegate-on-every-keystroke).
In API/metered mode, be stricter about fit and avoid wasteful retries.
