# Codex-style install + full `/grok:*` command UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the plugin install (marketplace) and operate (verb-based `/grok:*` slash commands) like OpenAI's `codex-plugin-cc`, exposing Grok's full command surface with a billing-safe `grok_cli` tool, without changing the delegation engine.

**Architecture:** Hybrid — the existing MCP server (`grok-build`) stays the billing-safe execution engine; a `/grok:*` command layer (markdown prompts calling MCP tools) sits on top. A new general `grok_cli` MCP tool runs arbitrary (allowlisted) grok subcommands under the billing-safe env to power utility commands + a `/grok:cli` passthrough.

**Tech Stack:** TypeScript (ESM, Node), `@modelcontextprotocol/sdk`, zod, esbuild, vitest. Design: `docs/specs/2026-07-13-codex-style-grok-ux-design.md`.

## Global Constraints

- **Billing safety #1:** every code path that spawns `grok` builds its env via `buildGrokEnv(mode)` (subscription default strips `XAI_API_KEY`/`GROK_CODE_XAI_API_KEY` + PATH prepend) and reports the `mode`/`billing` it ran under. No credential storage/logging.
- **Self-contained bundles:** `mcp-server/dist/index.js` + `dist/hook.js` are committed esbuild bundles; run `npm run build` before committing any `src/` change. On Windows, a CRLF-only `git status` on `dist/*` is a false positive — verify with `git diff --numstat`/`git hash-object` (committed == working ⇒ not stale).
- **Subprocess via arg arrays** (never string concat); `spawn`, not `exec`.
- **Keep all 100 existing tests green.** Target after this work: ~110.
- **Version-sensitive:** the plugin-command invocation string (`/grok:*`) and scoped MCP tool-name matcher are not officially fixed — re-verify on the installed Claude Code (CLAUDE.md gotcha).
- Single branch `feat/grok-namespace-codex-style-ux` off `main`; one PR.

## File Structure

- `.claude-plugin/plugin.json` — MODIFY: `name` → `grok`.
- `.claude-plugin/marketplace.json` — CREATE: marketplace catalog listing the `grok` plugin.
- `hooks/hooks.json` — MODIFY: matcher → `mcp__plugin_grok_grok-build__grok_build_(delegate|plan|verify)`.
- `mcp-server/src/grok-cli.ts` — CREATE: `runGrokCli` + `isBlockedGrokCommand` (general billing-safe runner).
- `mcp-server/test/grok-cli.test.ts` — CREATE: unit tests.
- `mcp-server/src/index.ts` — MODIFY: register the `grok_cli` tool.
- `mcp-server/dist/index.js` — REBUILD (committed bundle).
- `commands/*.md` — RENAME 3 + CREATE ~14 (thin `/grok:*` prompts).
- `README.md`, `README.ko.md`, `CLAUDE.md`, `docs/03-plugin-spec.md`, `docs/04-mcp-server-spec.md` — MODIFY.

---

### Task 1: Plugin rename + hook matcher + marketplace catalog

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `hooks/hooks.json`
- Create: `.claude-plugin/marketplace.json`

**Interfaces:**
- Produces: plugin name `grok`; hook matcher `mcp__plugin_grok_grok-build__grok_build_(delegate|plan|verify)`.

- [ ] **Step 1: Rename the plugin.** In `.claude-plugin/plugin.json` set `"name": "grok"` (keep `version`, `description`, `author`).

- [ ] **Step 2: Update the hook matcher.** In `hooks/hooks.json` change the matcher to:
```json
"matcher": "mcp__plugin_grok_grok-build__grok_build_(delegate|plan|verify)"
```

- [ ] **Step 3: Create the marketplace catalog** `.claude-plugin/marketplace.json`:
```json
{
  "name": "grok-marketplace",
  "owner": { "name": "xzawed" },
  "plugins": [
    {
      "name": "grok",
      "source": "./",
      "description": "Delegate coding tasks to xAI's Grok Build CLI on your Grok subscription; full /grok:* command surface."
    }
  ]
}
```
(⚠️ Marketplace schema is version-sensitive — verify field names against the installed Claude Code's `/plugin marketplace` reference before publishing.)

- [ ] **Step 4: Commit.**
```bash
git add .claude-plugin/plugin.json .claude-plugin/marketplace.json hooks/hooks.json
git commit -m "feat(plugin): rename to 'grok' (/grok:* namespace) + add marketplace catalog"
```

---

### Task 2: `grok_cli` — general billing-safe grok runner (TDD)

**Files:**
- Create: `mcp-server/src/grok-cli.ts`
- Test: `mcp-server/test/grok-cli.test.ts`

**Interfaces:**
- Consumes: `buildGrokEnv(mode, env)` from `./env.js`; `billingFor(mode)`, `type SpawnFn`, `type SpawnResult` from `./delegate.js`; `type AuthMode`, `type Billing` from `./types.js`.
- Produces:
  - `isBlockedGrokCommand(args: string[]): boolean`
  - `interface GrokCliDeps { spawn: SpawnFn; env: NodeJS.ProcessEnv }`
  - `interface GrokCliResult { status: 'ok'|'error'|'blocked'|'timeout'; exitCode: number|null; stdoutTail?: string; stderrTail?: string; mode: AuthMode; billing: Billing; message?: string }`
  - `runGrokCli(mode: AuthMode, args: string[], deps: GrokCliDeps, opts?: { cwd?: string; timeoutMs?: number }): Promise<GrokCliResult>`

- [ ] **Step 1: Write failing tests** `mcp-server/test/grok-cli.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { runGrokCli, isBlockedGrokCommand, type GrokCliDeps } from '../src/grok-cli.js';
import type { SpawnFn, SpawnResult } from '../src/delegate.js';

const fakeSpawn = (r: Partial<SpawnResult>, cap?: (a: string[], e: NodeJS.ProcessEnv) => void): SpawnFn =>
  async (args, _cwd, env) => { cap?.(args, env); return { code: 0, stdout: '', stderr: '', timedOut: false, ...r }; };
const deps = (spawnR: Partial<SpawnResult>, env: NodeJS.ProcessEnv = {}, cap?: (a: string[], e: NodeJS.ProcessEnv) => void): GrokCliDeps =>
  ({ spawn: fakeSpawn(spawnR, cap), env });

describe('isBlockedGrokCommand', () => {
  it('blocks non-headless commands', () => {
    for (const c of ['dashboard', 'agent', 'leader', 'completions', 'wrap']) {
      expect(isBlockedGrokCommand([c])).toBe(true);
    }
  });
  it('blocks interactive login but allows --device-auth login', () => {
    expect(isBlockedGrokCommand(['login'])).toBe(true);
    expect(isBlockedGrokCommand(['login', '--device-auth'])).toBe(false);
  });
  it('allows normal utility commands', () => {
    expect(isBlockedGrokCommand(['sessions', 'list'])).toBe(false);
    expect(isBlockedGrokCommand(['models'])).toBe(false);
  });
});

describe('runGrokCli', () => {
  it('blocked command returns status blocked without spawning', async () => {
    let spawned = false;
    const r = await runGrokCli('subscription', ['dashboard'], { spawn: async () => { spawned = true; return { code: 0, stdout: '', stderr: '', timedOut: false }; }, env: {} });
    expect(r.status).toBe('blocked');
    expect(spawned).toBe(false);
  });
  it('prepends --no-auto-update and applies billing-safe env (subscription strips keys)', async () => {
    let capArgs: string[] = []; let capEnv: NodeJS.ProcessEnv = {};
    await runGrokCli('subscription', ['models'], deps({ code: 0, stdout: 'gpt' }, { XAI_API_KEY: 'sk', PATH: '/usr/bin' }, (a, e) => { capArgs = a; capEnv = e; }));
    expect(capArgs[0]).toBe('--no-auto-update');
    expect(capArgs).toContain('models');
    expect(capEnv.XAI_API_KEY).toBeUndefined();
  });
  it('api mode passes keys through and reports metered_api billing', async () => {
    let capEnv: NodeJS.ProcessEnv = {};
    const r = await runGrokCli('api', ['models'], deps({ code: 0 }, { XAI_API_KEY: 'sk' }, (_a, e) => { capEnv = e; }));
    expect(capEnv.XAI_API_KEY).toBe('sk');
    expect(r.billing).toBe('metered_api');
  });
  it('exit 0 -> ok, non-zero -> error, timeout -> timeout', async () => {
    expect((await runGrokCli('subscription', ['models'], deps({ code: 0 }))).status).toBe('ok');
    expect((await runGrokCli('subscription', ['models'], deps({ code: 1, stderr: 'boom' }))).status).toBe('error');
    expect((await runGrokCli('subscription', ['models'], deps({ timedOut: true, code: null }))).status).toBe('timeout');
  });
  it('spawnError -> error', async () => {
    const r = await runGrokCli('subscription', ['models'], deps({ spawnError: true, code: null }));
    expect(r.status).toBe('error');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail.**
Run: `cd mcp-server && npx vitest run test/grok-cli.test.ts`
Expected: FAIL (`../src/grok-cli.js` cannot be loaded / exports undefined).

- [ ] **Step 3: Implement** `mcp-server/src/grok-cli.ts`:
```ts
import { buildGrokEnv } from './env.js';
import { billingFor, type SpawnFn, type SpawnResult } from './delegate.js';
import type { AuthMode, Billing } from './types.js';

// Commands that can't run headless (TUI/server/shell). Spawning them would hang or be meaningless.
const NON_HEADLESS = new Set(['dashboard', 'agent', 'leader', 'completions', 'wrap']);

export function isBlockedGrokCommand(args: string[]): boolean {
  const sub = args[0];
  if (!sub) return false;
  if (NON_HEADLESS.has(sub)) return true;
  if (sub === 'login' && !args.includes('--device-auth')) return true; // interactive browser OAuth
  return false;
}

export interface GrokCliDeps {
  spawn: SpawnFn;
  env: NodeJS.ProcessEnv;
}

export interface GrokCliResult {
  status: 'ok' | 'error' | 'blocked' | 'timeout';
  exitCode: number | null;
  stdoutTail?: string;
  stderrTail?: string;
  mode: AuthMode;
  billing: Billing;
  message?: string;
}

export async function runGrokCli(
  mode: AuthMode,
  args: string[],
  deps: GrokCliDeps,
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<GrokCliResult> {
  const billing = billingFor(mode);
  if (isBlockedGrokCommand(args)) {
    return {
      status: 'blocked', exitCode: null, mode, billing,
      message: `\`grok ${args[0]}\`는 대화형/서버 모드라 헤드리스로 실행할 수 없습니다. 터미널에서 직접 실행하세요.`,
    };
  }
  const cwd = opts.cwd ?? process.cwd();
  const timeoutMs = opts.timeoutMs ?? 60000;
  const env = buildGrokEnv(mode, deps.env);
  const r: SpawnResult = await deps.spawn(['--no-auto-update', ...args], cwd, env, timeoutMs);
  if (r.spawnError) {
    return { status: 'error', exitCode: r.code, mode, billing, stderrTail: (r.stderr || '').slice(-500), message: 'grok 실행에 실패했습니다 (설치/PATH 확인).' };
  }
  if (r.timedOut) {
    return { status: 'timeout', exitCode: null, mode, billing, message: `grok 명령이 ${Math.round(timeoutMs / 1000)}초 내에 끝나지 않았습니다.` };
  }
  return {
    status: r.code === 0 ? 'ok' : 'error',
    exitCode: r.code,
    stdoutTail: (r.stdout || '').slice(-4000),
    stderrTail: (r.stderr || '').slice(-1000),
    mode, billing,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass.**
Run: `cd mcp-server && npx vitest run test/grok-cli.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit.**
```bash
git add mcp-server/src/grok-cli.ts mcp-server/test/grok-cli.test.ts
git commit -m "feat(grok-cli): billing-safe general grok subcommand runner + non-headless denylist"
```

---

### Task 3: Register `grok_cli` in the MCP server + rebuild

**Files:**
- Modify: `mcp-server/src/index.ts`
- Rebuild: `mcp-server/dist/index.js`

**Interfaces:**
- Consumes: `runGrokCli`, `type GrokCliDeps` from `./grok-cli.js`; `resolveAuthMode()`; `defaultSpawn` from `./delegate.js`.

- [ ] **Step 1: Import and register the tool.** In `mcp-server/src/index.ts` add the import `import { runGrokCli } from './grok-cli.js';` and `import { defaultSpawn } from './delegate.js';` (if not already imported), then register after `grok_build_usage`:
```ts
  server.registerTool(
    'grok_cli',
    {
      description: "Run an arbitrary Grok CLI subcommand (sessions, models, inspect, mcp, export, worktree, login --device-auth, logout, memory, update, version, trace, or a raw passthrough) under the billing-safe env. Non-headless commands (dashboard/agent/leader/completions/wrap, interactive login) are refused with guidance. Use for grok management/utility; use grok_build_delegate for coding tasks.",
      inputSchema: z.object({
        args: z.array(z.string()).min(1).describe('grok subcommand + args, e.g. ["sessions","list"] or ["inspect","--json"].'),
        cwd: z.string().optional().describe('Working directory (absolute).'),
        timeout_ms: z.number().int().positive().optional().describe('Default 60000.'),
      }),
    },
    async ({ args, cwd, timeout_ms }) => {
      const result = await runGrokCli(mode, args, { spawn: defaultSpawn, env: process.env }, { cwd, timeoutMs: timeout_ms });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: result.status === 'error' };
    },
  );
```

- [ ] **Step 2: Typecheck.**
Run: `cd mcp-server && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Rebuild the bundles.**
Run: `cd mcp-server && npm run build`
Expected: `bundled -> dist/index.js, dist/hook.js`.

- [ ] **Step 4: Full test suite.**
Run: `cd mcp-server && npm test`
Expected: all pass (~110).

- [ ] **Step 5: Commit** (include the rebuilt bundle; skip `dist/hook.js` if `git hash-object` shows it unchanged = CRLF-only).
```bash
git add mcp-server/src/index.ts mcp-server/dist/index.js
git commit -m "feat(server): register grok_cli MCP tool"
```

---

### Task 4: `/grok:*` command markdown files

**Files:**
- Delete/rename: `commands/grok-build-delegate.md`, `commands/grok-build-check-auth.md`, `commands/grok-build-usage.md`
- Create: `commands/grok-<verb>.md` for each verb below.

**Template** (every command file is this shape — frontmatter `description` + a body telling Claude which tool to call):
```markdown
---
description: <one-line description>
---

<instruction body>
```

- [ ] **Step 1: Delegation/onboarding commands.** Create these files with the given bodies:

  - `commands/grok-setup.md` — desc `Verify Grok is installed and signed in; guide setup`. Body: "Call `grok_auth_check`. If `ok`, report the `mode` and that Grok is ready. If not: for `grok_not_installed` tell the user to run `curl -fsSL https://x.ai/cli/install.sh | bash`; for `not_logged_in` tell them to run `grok login`; for `no_api_key` tell them to set `XAI_API_KEY`. Always show the `message`."
  - `commands/grok-delegate.md` — desc `Delegate a coding task to Grok`. Body: same as the current delegate command (auth_check → `grok_build_delegate` with the task as `prompt` + cwd; show `summary`/`filesChanged`/`billing`; don't commit).
  - `commands/grok-plan.md` — desc `Read-only Grok plan preview (no edits)`. Body: "Call `grok_build_plan` with the task as `prompt` + cwd; show the plan `summary`. No files are edited."
  - `commands/grok-verify.md` — desc `Delegate + Grok self-verification`. Body: "Call `grok_build_verify` with the task as `prompt` + cwd; show `summary`, `filesChanged`, and `billing`. Don't commit."
  - `commands/grok-usage.md` — desc `Grok delegation usage summary`. Body: same as the current usage command.

- [ ] **Step 2: Utility commands via `grok_cli`.** Create each with desc + body "Call `grok_cli` with `args: [<ARGS>]` (append any user-provided flags) and present `stdoutTail` (and `stderrTail` on error). Report `billing` if it spawned.", using these `<ARGS>` and descriptions:

  | File | description | `<ARGS>` base |
  |---|---|---|
  | `grok-sessions.md` | List/search/restore Grok sessions | `["sessions", ...userArgs]` |
  | `grok-export.md` | Export a Grok session transcript to Markdown | `["export", ...userArgs]` |
  | `grok-import.md` | Import sessions into Grok | `["import", ...userArgs]` |
  | `grok-memory.md` | Manage Grok cross-session memory | `["memory", ...userArgs]` |
  | `grok-inspect.md` | Show the config Grok discovers here | `["inspect", "--json"]` |
  | `grok-models.md` | List available Grok models | `["models"]` |
  | `grok-mcp.md` | Manage Grok's MCP server configs | `["mcp", ...userArgs]` |
  | `grok-worktree.md` | Manage Grok git worktrees | `["worktree", ...userArgs]` |
  | `grok-login.md` | Sign in to Grok (headless device-code) | `["login", "--device-auth"]` |
  | `grok-logout.md` | Sign out of Grok | `["logout"]` |
  | `grok-update.md` | Check/install Grok updates | `["update", ...userArgs]` |
  | `grok-version.md` | Show Grok version | `["version"]` |
  | `grok-trace.md` | Export/upload Grok session trace | `["trace", ...userArgs]` |

- [ ] **Step 3: Passthrough command.** Create `commands/grok-cli.md` — desc `Run any Grok CLI command (passthrough)`. Body: "Parse the user's raw grok arguments into an array and call `grok_cli` with `args`. If the result `status` is `blocked`, relay its `message` (the command must be run in a real terminal). Otherwise present `stdoutTail`/`stderrTail` and note `billing`."

- [ ] **Step 4: Commit.**
```bash
git add commands/
git commit -m "feat(commands): /grok:* verb command set + /grok:cli passthrough"
```

---

### Task 5: Documentation

**Files:** `README.md`, `README.ko.md`, `CLAUDE.md`, `docs/03-plugin-spec.md`, `docs/04-mcp-server-spec.md`

- [ ] **Step 1: READMEs.** Replace the install section with the 4-step marketplace flow (`/plugin marketplace add xzawed/claude-grok-build-plugin` → `/plugin install grok@grok-marketplace` → `/reload-plugins` → `/grok:setup`) and add a `/grok:*` command table (setup/delegate/plan/verify/usage + utility verbs + `/grok:cli`). Note grok must still be installed + `grok login` run once.

- [ ] **Step 2: CLAUDE.md.** Update: plugin renamed to `grok` (component map + hook matcher line); add `grok-cli.ts` (`runGrokCli`) to the src component map; add `grok_cli` to the tool list; add the command list; bump the test count; note the marketplace.json.

- [ ] **Step 3: docs/03-plugin-spec.md.** Add `marketplace.json`, plugin.json `name: grok`, the renamed/new `commands/*.md` tree, the updated hook matcher, and `grok-cli.ts`/`grok_cli` in the structure + Hook sections.

- [ ] **Step 4: docs/04-mcp-server-spec.md.** Add a `grok_cli` section (input `{args, cwd?, timeout_ms?}`, output `GrokCliResult` shape, denylist behaviour, billing-safe env, mode/billing report).

- [ ] **Step 5: Commit.**
```bash
git add README.md README.ko.md CLAUDE.md docs/03-plugin-spec.md docs/04-mcp-server-spec.md
git commit -m "docs: Codex-style install + /grok:* command surface + grok_cli"
```

---

### Task 6: Final verification + PR

- [ ] **Step 1: Rebuild + full checks.**
Run: `cd mcp-server && npm run build && npm test && npm run typecheck && npm audit`
Expected: `bundled -> ...`, ~110 passed, no type errors, 0 vulnerabilities.

- [ ] **Step 2: Consistency check.** Confirm `plugin.json` name (`grok`), `marketplace.json` plugin name (`grok`), and `hooks/hooks.json` matcher (`mcp__plugin_grok_...`) agree; every `commands/*.md` references a real tool (`grok_auth_check`/`grok_build_delegate`/`grok_build_plan`/`grok_build_verify`/`grok_build_usage`/`grok_cli`); no stray `grok-build:` command references remain in docs.

- [ ] **Step 3: dist sync.** `git status --porcelain mcp-server/dist` — for any `M`, confirm real vs CRLF via `git hash-object` (committed vs working). Commit only real changes.

- [ ] **Step 4: Push + open ONE PR to main.**
```bash
git push -u origin feat/grok-namespace-codex-style-ux
gh pr create --base main --head feat/grok-namespace-codex-style-ux --title "feat: Codex-style install + full /grok:* command UX (grok_cli)" --body-file <pr-body>
```

---

## Self-Review

- **Spec coverage:** rename (T1), marketplace.json (T1), grok_cli tool (T2) + register (T3), command set incl. setup + passthrough (T4), docs (T5), verification/PR (T6). Billing safety enforced in grok_cli (T2). Denylist for E-group (T2). All spec sections covered.
- **Placeholder scan:** command bodies specified via template + per-file params (no "similar to"); grok_cli code is complete; no TBD.
- **Type consistency:** `GrokCliResult`/`GrokCliDeps`/`runGrokCli`/`isBlockedGrokCommand` names match across T2 tests, T2 impl, and T3 registration; reuses existing `SpawnFn`/`SpawnResult`/`billingFor`/`buildGrokEnv`.
