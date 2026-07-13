# `pre-delegate-auth-check` PreToolUse hook — design (Phase 2)

- **Date:** 2026-07-13
- **Status:** approved (brainstorming) → ready for implementation
- **Scope:** Phase 2 roadmap item "`pre-delegate-auth-check` hook 추가 (harness 레벨 방어)".
  A PreToolUse hook that blocks `grok_build_delegate` / `grok_build_plan` / `grok_build_verify`
  before they reach the MCP server **when auth is certainly not ready**, layered on top of
  the existing server-internal `checkAuth`. Fulfils the last unbuilt Phase 2 component.

## Verified harness contract (claude-code-guide, Claude Code ~v2.1.205, 2026-07-11)

Version-sensitive — **re-verify against the installed Claude Code before/at implementation**
(see CLAUDE.md gotcha on plugin-schema drift). Findings:

1. **`hooks/hooks.json`** at the plugin root is **auto-discovered** (no manifest entry). Event
   keys are top-level (`{"PreToolUse":[{ "matcher", "hooks":[{"type":"command","command"}] }]}`).
2. **Blocking (current form):** the hook command exits `0` and writes to stdout:
   `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<msg>"}}`.
   `permissionDecision` ∈ `allow|deny|ask`. (Legacy `exit 2` + stderr also blocks; the JSON form
   is canonical and surfaces the reason to Claude and the user.)
3. **stdin payload** includes `tool_name`, `tool_input`, `cwd`, `permission_mode`,
   `hook_event_name`, `session_id`.
4. **MCP tool matcher** for a plugin-bundled server: `mcp__plugin_<plugin>_<server>__<tool>`.
   Bare `mcp__<server>__<tool>` does **not** fire. `matcher` supports regex alternation.
   For us: `mcp__plugin_claude-grok-build-plugin_grok-build__grok_build_(delegate|plan|verify)`.
5. **CRITICAL — env visibility:** the `.mcp.json` `env` block is applied **only** to the MCP
   server subprocess, **not** to hook processes. Hooks inherit only the environment Claude Code
   was launched with, plus injected `$CLAUDE_*` vars (incl. `$CLAUDE_PLUGIN_ROOT`). So a user who
   sets `GROK_BUILD_AUTH_MODE`/`XAI_API_KEY` **only in `.mcp.json`** is invisible to the hook.

## Key decisions (settled during brainstorming)

1. **Behaviour = "deny only when certain" (never false-block).** The server-internal `checkAuth`
   (`index.ts:40,66,94`) is already the authoritative gate and sees the real mode + real env. The
   hook is best-effort harness-level defense-in-depth. Because of finding #5 it **must not**
   hard-block on mode-dependent state it cannot be sure of — a false deny would kill a legitimate
   (paying) delegation that the server would have allowed.
   - `grok` not installed → **deny** (mode-independent, always correct).
   - Mode is **known** in the hook's own env (`GROK_BUILD_AUTH_MODE` explicitly `subscription`/`api`)
     → run the full `checkAuth` for that mode; deny if not ready.
   - Mode is **unknown** (env unset/empty/invalid → ambiguous: default-subscription vs
     api-set-via-`.mcp.json`) → **allow**; defer auth-state to the server's authoritative check.
2. **Implementation = Node bundle reusing `checkAuth` (single source of truth).** New
   `mcp-server/src/hook.ts` entrypoint → esbuild → committed `mcp-server/dist/hook.js`, run by the
   hook as `node "${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/hook.js"`. Reuses `checkAuth`,
   `defaultAuthDeps`, and the exact Korean messages from `auth.ts` — **no duplicated logic or
   strings** (a POSIX-shell reimplementation was rejected precisely to avoid message/logic drift,
   the class of bug just fixed in the docs pass).
3. **Gated tools = delegate + plan + verify** (all spawn `grok` and need auth). `grok_build_usage`
   (read-only history) and `grok_auth_check` (it *is* the check) are **not** gated.
4. **Fail-open on any hook error.** Parse failure, unexpected exception, invalid mode value — all
   resolve to *allow* (exit 0). A hook bug must never block legitimate work; the server remains the
   real gate. (Contrast: the server's `resolveAuthMode` fail-fast *throws* on an invalid value —
   the hook deliberately does not.)

## Components

### `mcp-server/src/auth.ts` (minimal refactor)
Extract the grok-not-installed message to a shared constant so `checkAuth` and the hook use one
string:
```ts
export const GROK_NOT_INSTALLED_MESSAGE = 'Grok Build CLI를 PATH에서 찾을 수 없습니다. ...';
```
`checkAuth` returns it from its `grok_not_installed` branch (no behaviour change).

### `mcp-server/src/hook.ts` (new)
A pure decision function + a thin IO wrapper, both DI-testable (mirrors `auth.ts`/`delegate.ts`):

```ts
export type HookMode = AuthMode | 'unknown';

export function resolveHookMode(env: NodeJS.ProcessEnv): HookMode {
  const v = env.GROK_BUILD_AUTH_MODE;
  return v === 'subscription' || v === 'api' ? v : 'unknown'; // never throws
}

export function decideHook(mode: HookMode, deps: AuthDeps): { deny: boolean; reason?: string } {
  if (!deps.grokInstalled()) return { deny: true, reason: GROK_NOT_INSTALLED_MESSAGE };
  if (mode === 'unknown') return { deny: false };            // defer auth-state to the server
  const r = checkAuth(mode, deps);                            // grok already known installed
  return r.ok ? { deny: false } : { deny: true, reason: r.message };
}

// IO wrapper (DI: stdin/stdout/exit/env/deps), wrapped in try/catch → fail-open (allow)
export async function runHook(io): Promise<void> { ... }
```
On `deny`, `runHook` writes the `hookSpecificOutput` deny JSON to stdout and exits 0. On allow (or
any caught error) it exits 0 with no output.

### `hooks/hooks.json` (new, plugin root — auto-discovered)
```json
{
  "PreToolUse": [
    {
      "matcher": "mcp__plugin_claude-grok-build-plugin_grok-build__grok_build_(delegate|plan|verify)",
      "hooks": [
        { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/hook.js\"" }
      ]
    }
  ]
}
```

### `mcp-server/build.mjs` + `.gitignore`
Add `src/hook.ts` as a second esbuild entry producing `dist/hook.js` (same self-contained banner).
`.gitignore` gains `!mcp-server/dist/hook.js` so the bundle ships (parallel to `dist/index.js`).

## Data flow (one gated call)

1. Claude calls `grok_build_delegate|plan|verify`.
2. Claude Code matches the PreToolUse matcher → runs `node dist/hook.js` (stdin JSON; env = Claude
   Code launch env + `$CLAUDE_*`).
3. `runHook`: `resolveHookMode(process.env)` → `defaultAuthDeps()` → `decideHook`:
   - grok not installed → **deny** (message) → Claude Code blocks the tool, shows the reason. STOP.
   - mode unknown → **allow** (defer).
   - mode known + auth not ready → **deny** (message). STOP.
   - ready → **allow**.
4. If allowed, the call reaches the MCP server → server `checkAuth` (authoritative, real env) makes
   the final decision → `runDelegate`.

## Error handling

- Any exception / stdin-parse failure / invalid `GROK_BUILD_AUTH_MODE` → **fail-open** (exit 0,
  allow). The server is the real gate; a hook fault must not block legitimate delegations.

## Testing (vitest, DI — same pattern as `auth`/`delegate` tests)

- `resolveHookMode`: `subscription` / `api` / unset→`unknown` / `''`→`unknown` / `xyz`→`unknown`.
- `decideHook`:
  - grok not installed → deny(grok msg) for each of subscription / api / unknown.
  - subscription: auth.json missing → deny(not_logged_in); present → allow.
  - api: key missing → deny(no_api_key); key present → allow.
  - **unknown + grok installed → allow regardless of auth.json/key** (the never-false-block guarantee).
- `runHook` (IO via DI): deny path writes exact `hookSpecificOutput` JSON + exit 0; allow path no
  output + exit 0; thrown deps → fail-open allow.
- Expected +~11 tests → 72 → ~83. `npm run build` must emit a self-contained `dist/hook.js`.

## Out of scope

- Blocking on auth **expiry** (server-internal expiry-signal anchoring is a separate Phase 2 item,
  gated on capturing the real grok expiry string).
- `PATH` prepend so GUI/daemon-launched Claude Code finds `grok` (separate Phase 2 item; the hook's
  grok-not-installed check shares the same PATH caveat and benefits from that fix).
- Any credential storage/logging (absolute principle #4 — the hook only checks presence).

## Docs to update after implementation (global "keep docs current" rule)

`docs/03-plugin-spec.md` (Hook section: draft → built), `docs/06-roadmap.md` (check the item),
`docs/01-architecture.md` + `CLAUDE.md` (hooks/ 미구현 → 구현; component map; test count; next-work),
`README.md`/`README.ko.md` (status banner: nothing unbuilt in Phase 2 except PATH-prepend /
auth-expiry).
