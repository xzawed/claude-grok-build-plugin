# Codex-plugin-style install + full `/grok:*` command UX — design (Phase 4 / UX)

- **Date:** 2026-07-13
- **Status:** approved (brainstorming) → ready for implementation plan
- **Goal:** Make the plugin **install and operate like OpenAI's `codex-plugin-cc`** (marketplace
  install + verb-based slash commands), but for pure Grok — so a Claude Code user who also has a
  Grok subscription can drive Grok's full command surface from inside Claude with no inconvenience.
  This is about matching the Codex plugin's **style**, NOT integrating with Codex or copying its
  features.

## Decisions (settled during brainstorming)

1. **Hybrid architecture.** Keep the existing MCP server (`grok-build`) as the billing-safe
   execution engine (unchanged internally); add a user-facing `/grok:*` slash-command UX layer on
   top (each command = a markdown prompt that calls an MCP tool). Claude auto-delegation via MCP is
   retained. (Rejected: dropping MCP and shelling out from a subagent — would re-implement the
   billing-safe env stripping and lose auto-delegation.)
2. **`/grok:*` namespace.** Rename the plugin so its commands namespace as `/grok:*`.
3. **Coverage = core verbs + universal passthrough.** Frequently-used grok functions get dedicated
   `/grok:*` commands; a `/grok:cli "<raw args>"` passthrough covers everything else → full grok
   surface, zero inconvenience. Commands that cannot run headless are excluded/guarded.
4. **Codex FEATURES are out of scope** (background async jobs `status`/`result`/`cancel`, session
   `transfer`). We match the install + command *style*, staying synchronous.

## Reference (researched 2026-07-13): `openai/codex-plugin-cc`

Installs via marketplace (`/plugin marketplace add openai/codex-plugin-cc` → `/plugin install
codex@openai-codex` → `/reload-plugins` → `/codex:setup`); operates via verb slash commands
(`/codex:setup`, `/codex:rescue` via a subagent, `/codex:review`, …) + hooks; NO MCP server; reuses
the local codex binary + credentials. We mirror the **install + verb-command style**, keeping our
MCP engine underneath.

## Measured grok CLI command surface (this machine, `grok --help`)

- **A. Coding/delegation (engine already covers):** default prompt = delegate; `--check` = verify;
  `--permission-mode plan` = plan; flags `--best-of-n`, `--worktree`, `--sandbox`, `--model`,
  `--effort`, `--resume`/`--continue`.
- **B. Sessions/history:** `sessions` (list/search/restore), `export`, `import`, `memory`, `trace`.
- **C. Auth/config/info:** `login` (`--device-auth` is headless-capable), `logout`, `setup`
  (managed config), `inspect`, `models`, `version`, `update`.
- **D. Integration mgmt:** `mcp` (list/add/remove/doctor), `plugin`, `worktree`.
- **E. NOT headless-capable (excluded / guarded):** `dashboard` (TUI), `agent` (stdio/serve/leader —
  server modes; our MCP server already is the programmatic path), `leader`, `completions`, `wrap`.

## Architecture

### Install parity
- **`.claude-plugin/marketplace.json`** (new marketplace catalog) so the repo installs via the
  4-step flow above. It lists one plugin (`grok`) pointing at this repo's plugin root.
- **`.claude-plugin/plugin.json`**: `name` `claude-grok-build-plugin` → **`grok`** (Claude Code
  namespaces plugin commands as `/<plugin-name>:<cmd>`, so `/grok:*` requires the plugin name to be
  `grok`). Keep `description`/`author`/`version`.
- **`hooks/hooks.json`** matcher updated to the new plugin name:
  `mcp__plugin_grok_grok-build__grok_build_(delegate|plan|verify)`. (MCP server name stays
  `grok-build`.) ⚠️ The exact scoped tool-name / command-invocation format is version-sensitive —
  re-verify on the installed Claude Code (existing CLAUDE.md gotcha).

### New MCP tool: `grok_cli` (general billing-safe grok runner)
The one substantive new piece of code. Powers the utility verb commands and the `/grok:cli`
passthrough.
- **Input:** `{ args: string[]; cwd?: string; timeout_ms?: number }` — the grok subcommand + args
  (e.g. `["sessions","list"]`, `["inspect","--json"]`, `["models"]`).
- **Behaviour:**
  - Prepends `--no-auto-update`.
  - Runs `grok` with **`buildGrokEnv(mode)`** (subscription strips `XAI_API_KEY`/`GROK_CODE_XAI_API_KEY`
    + PATH prepend) — the same billing-safe env as delegate. Applies a timeout (default 60s).
  - **Non-headless denylist** — if `args[0]` (or the whole command) is a known TUI/server/interactive
    command (`dashboard`, `agent` [serve/stdio/leader], `leader`, `completions`, `wrap`, and `login`
    WITHOUT `--device-auth`), it does NOT spawn (would hang); it returns a message telling the user
    to run it in their terminal.
  - Returns a structured result: `{ status: "ok"|"error"|"blocked"|"timeout", exitCode, stdoutTail,
    stderrTail, mode, billing }` (mode/billing included for #1 transparency — a passthrough `-p`
    still bills correctly because keys are stripped in subscription mode).
- **DI-testable** (spawn/env injected), mirroring `delegate.ts`/`auth.ts`. Registered in `index.ts`.

### `/grok:*` command layer (`commands/*.md`)
Thin markdown prompts, each instructing Claude to call the matching MCP tool and summarize the
result. Rename existing three, add the rest:
- **Onboarding:** `/grok:setup` → `grok_auth_check` + guidance (install via
  `curl -fsSL https://x.ai/cli/install.sh | bash`, `grok login`; report mode/billing). Absorbs the
  old `grok-build-check-auth`.
- **Delegation (existing tools):** `/grok:delegate`, `/grok:plan`, `/grok:verify`, `/grok:usage`.
- **Utility (via `grok_cli`):** `/grok:sessions`, `/grok:export`, `/grok:import`, `/grok:memory`,
  `/grok:inspect`, `/grok:models`, `/grok:mcp`, `/grok:worktree`, `/grok:login`, `/grok:logout`,
  `/grok:update`, `/grok:version`, `/grok:trace`.
- **Passthrough:** `/grok:cli "<raw args>"` → `grok_cli` with the raw args (covers the long tail;
  E-group is guarded by the denylist).

(Command-file basenames stay kebab-case, e.g. `grok-delegate.md`; the `/grok:` prefix comes from the
plugin name. The precise invocation string is verified on install.)

## Billing safety (#1 absolute principle) — unchanged
`grok_build_delegate/plan/verify` and the new `grok_cli` all build the grok env via
`buildGrokEnv(mode)` (subscription default strips API keys) and report the `mode`/`billing` they ran
under. No new credential storage/logging. The passthrough cannot leak billing: even `grok:cli -p
"task"` runs under the stripped env in subscription mode.

## Error handling
- `grok_cli`: non-headless command → `blocked` with terminal-run guidance (no spawn, no hang);
  spawn failure → `error`; timeout → `timeout`. Same DI/timeout discipline as `delegate.ts`.

## Testing
- `grok_cli`: DI unit tests — billing-safe env applied (subscription strips keys), denylist blocks
  each non-headless command without spawning, `--device-auth` login is allowed, ok/error/timeout
  classification, mode/billing reported. (~10 tests; 100 → ~110.)
- Command markdown + manifests: no unit tests; a consistency check that plugin.json name, marketplace.json,
  and hooks.json matcher agree, and that every `commands/*.md` references a real tool.
- Existing 100 tests unaffected (delegation/env/auth/hook logic unchanged).

## Out of scope
- Codex FEATURES: background async jobs (`status`/`result`/`cancel`), session `transfer`.
- E-group as functioning slash commands (TUI/server/shell — guarded, not implemented).
- Phase 4 orchestrator routing (separate).

## Docs to update
- `README.md`/`README.ko.md`: 4-step marketplace install + the `/grok:*` command table.
- `CLAUDE.md`: plugin rename, `grok_cli` in the component map, command list, test count, hook matcher.
- `docs/03-plugin-spec.md`: marketplace.json, plugin.json name, command rename, hooks matcher.
- `docs/04-mcp-server-spec.md`: `grok_cli` tool request/response schema.
