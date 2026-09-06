// pre-delegate-auth-check — PreToolUse hook logic (Phase 2).
//
// Harness-level defense-in-depth layered on top of the server-internal checkAuth
// (index.ts). Because a PreToolUse hook runs as a SEPARATE process it does NOT see
// the `.mcp.json` `env` block — only the environment Claude Code was launched with.
// So it must "deny only when certain" and never false-block a legitimate delegation:
//   - grok not installed         → deny  (mode-independent, always correct)
//   - mode resolves + not ready  → deny  (reuses checkAuth for that mode)
//   - mode unresolvable          → allow (defer auth-state to the authoritative server)
// Pure functions here (DI-testable); the executable wiring lives in hook-entry.ts.
import { checkAuth, GROK_NOT_INSTALLED_MESSAGE, type AuthDeps } from './auth.js';
import { resolveAuthMode } from './config.js';
import { mayRunTurn } from './prompt-flags.js';
import type { AuthMode } from './types.js';

export type HookMode = AuthMode | 'unknown';

/**
 * A7 (docs/10, MEASURED 2026-09-05 against the shipped dist/hook.js): this used to demand an
 * explicit, exactly-cased value and call everything else 'unknown', while the server trimmed,
 * lowercased, and read unset as 'subscription'. Since `.mcp.json` ships NO env block, "unset" is
 * the shipped configuration — so the subscription deny branch below never armed in production,
 * and every test that exercised it passed an explicit mode and stayed green. Measured before the
 * fix, with grok installed and no auth.json:
 *   env -u GROK_BUILD_AUTH_MODE  ->  no output (allow)   <- shipped
 *   GROK_BUILD_AUTH_MODE=subscription ->  deny "grok login"
 *   GROK_BUILD_AUTH_MODE=Subscription ->  no output (allow)
 *
 * Delegating to the server's own parser, rather than re-deriving trim/lowercase/default here, is
 * what makes a second drift impossible: there is now one definition of "what mode is this?".
 *
 * The one thing the hook may NOT inherit is the throw. A hook that crashes blocks nothing, and an
 * invalid value stops the server from starting at all (A12) — denying it with "run `grok login`"
 * would send the user to fix the wrong thing. That case alone stays 'unknown' → allow.
 */
export function resolveHookMode(env: NodeJS.ProcessEnv): HookMode {
  try {
    return resolveAuthMode(env);
  } catch {
    return 'unknown';
  }
}

export function decideHook(mode: HookMode, deps: AuthDeps): { deny: boolean; reason?: string } {
  // Deny only on signals the hook and the server observe IDENTICALLY, so a hook deny can
  // never contradict what the server would do (never false-block a legitimate delegation):
  //   - grok-not-installed: both probe PATH the same way (mode-independent) — EXCEPT when
  //     GROK_BIN_DIR is set ONLY in the server-only .mcp.json env (which the hook process never
  //     sees): the server then finds grok at that custom dir while the hook falls back to the
  //     default ~/.grok/bin and can false-deny. Export GROK_BIN_DIR in the launch env (not only
  //     .mcp.json), or install grok at the default ~/.grok/bin, to keep the two consistent.
  //   - subscription: the auth.json FILE under grok's config dir is visible to both processes.
  //     GROK_HOME relocates that dir (see env.ts `grokHome`) and carries the SAME caveat as
  //     GROK_BIN_DIR: set only in the server-only .mcp.json env, the server would read the
  //     relocated token while the hook probes the default ~/.grok and false-denies. Export
  //     GROK_HOME in the launch env so both processes resolve the same file.
  //   - the MODE itself carries that caveat one level up (A7). Defaulting unset to 'subscription'
  //     is right for everything this plugin ships (no env block in .mcp.json) and matches
  //     resolveAuthMode exactly. The residual: someone who sets GROK_BUILD_AUTH_MODE=api ONLY in
  //     the server-only .mcp.json env is read here as subscription and false-denied when no
  //     auth.json exists. Same remedy as the two above — export it in the launch env, not only in
  //     .mcp.json. (A hand-edited .mcp.json does not survive a plugin update anyway: the cache is
  //     version-keyed.)
  // api key-absence is NOT such a signal — the key may live in the server-only .mcp.json
  // env block (invisible to a hook subprocess), so 'api' (and unresolvable 'unknown') defer
  // auth-state to the authoritative server checkAuth.
  if (!deps.grokInstalled()) return { deny: true, reason: GROK_NOT_INSTALLED_MESSAGE };
  if (mode === 'subscription') {
    const r = checkAuth('subscription', deps); // grok already known installed; checks auth.json
    return r.ok ? { deny: false } : { deny: true, reason: r.message };
  }
  return { deny: false }; // 'api' or 'unknown' → let the server decide
}

// A2 (docs/10, MEASURED 2026-09-05): the matcher used to cover only delegate/plan/verify, so a
// `grok_cli` passthrough carrying `-p` walked past this gate while editing files and spending a
// subscription turn. Adding grok_cli to the matcher creates the opposite hazard — denying
// `grok --version` or `grok sessions list` because there is no session would break exactly the
// commands someone runs to work out WHY there is no session. So the gate follows the prompt.
export interface HookPayload {
  toolName?: string;
  args?: string[];
}

/** Never throws: an unreadable payload yields an empty one, and the caller decides what that means. */
export function parseHookPayload(raw: string): HookPayload {
  try {
    const j = JSON.parse(raw) as { tool_name?: unknown; tool_input?: { args?: unknown } };
    const toolName = typeof j?.tool_name === 'string' ? j.tool_name : undefined;
    const rawArgs = j?.tool_input?.args;
    const args = Array.isArray(rawArgs) ? rawArgs.filter((x): x is string => typeof x === 'string') : undefined;
    return { toolName, args };
  } catch {
    return {};
  }
}

/**
 * Whether this call needs the auth gate at all.
 *
 * Everything except a read-only grok_cli query does. The default is deliberately the strict one:
 * `runGrokCli` never calls `checkAuth`, so unlike delegate this hook is the ONLY auth gate a
 * passthrough gets — an unreadable payload must fail CLOSED here, not defer to a check that does
 * not exist.
 */
export function needsAuthGate(payload: HookPayload): boolean {
  if (!payload.toolName?.endsWith('grok_cli')) return true;
  return mayRunTurn(payload.args ?? []);
}
export interface HookIO {
  readStdin: () => Promise<string>;
  writeStdout: (s: string) => void;
  env: NodeJS.ProcessEnv;
  deps: AuthDeps;
}

export async function runHook(io: HookIO): Promise<void> {
  try {
    const payload = parseHookPayload(await io.readStdin());
    // grok-not-installed is mode- and payload-independent: `grok --version` cannot work either.
    // The auth branch is the one a read-only query is exempt from.
    const decision = needsAuthGate(payload)
      ? decideHook(resolveHookMode(io.env), io.deps)
      : io.deps.grokInstalled()
        ? { deny: false }
        : { deny: true, reason: GROK_NOT_INSTALLED_MESSAGE };
    if (decision.deny) {
      io.writeStdout(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: decision.reason,
          },
        }),
      );
    }
    // allow: no output (absence of a decision = allow)
  } catch {
    // fail-open: a hook fault must never block a legitimate delegation — the
    // server-internal checkAuth remains the authoritative gate.
  }
}
