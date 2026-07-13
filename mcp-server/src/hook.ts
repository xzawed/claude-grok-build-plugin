// pre-delegate-auth-check — PreToolUse hook logic (Phase 2).
//
// Harness-level defense-in-depth layered on top of the server-internal checkAuth
// (index.ts). Because a PreToolUse hook runs as a SEPARATE process it does NOT see
// the `.mcp.json` `env` block — only the environment Claude Code was launched with.
// So it must "deny only when certain" and never false-block a legitimate delegation:
//   - grok not installed        → deny  (mode-independent, always correct)
//   - mode known + not ready     → deny  (reuses checkAuth for that mode)
//   - mode unknown (ambiguous)   → allow (defer auth-state to the authoritative server)
// Pure functions here (DI-testable); the executable wiring lives in hook-entry.ts.
import { checkAuth, GROK_NOT_INSTALLED_MESSAGE, type AuthDeps } from './auth.js';
import type { AuthMode } from './types.js';

export type HookMode = AuthMode | 'unknown';

// Unlike the server's resolveAuthMode (which throws on an invalid value at startup),
// the hook must never crash-block: anything but an explicit mode is 'unknown'.
export function resolveHookMode(env: NodeJS.ProcessEnv): HookMode {
  const v = env.GROK_BUILD_AUTH_MODE;
  return v === 'subscription' || v === 'api' ? v : 'unknown';
}

export function decideHook(mode: HookMode, deps: AuthDeps): { deny: boolean; reason?: string } {
  // Deny only on signals the hook and the server observe IDENTICALLY, so a hook deny can
  // never contradict what the server would do (never false-block a legitimate delegation):
  //   - grok-not-installed: both probe PATH the same way (mode-independent).
  //   - subscription: the ~/.grok/auth.json FILE is visible to both processes.
  // api key-absence is NOT such a signal — the key may live in the server-only .mcp.json
  // env block (invisible to a hook subprocess), so 'api' (and ambiguous 'unknown') defer
  // auth-state to the authoritative server checkAuth.
  if (!deps.grokInstalled()) return { deny: true, reason: GROK_NOT_INSTALLED_MESSAGE };
  if (mode === 'subscription') {
    const r = checkAuth('subscription', deps); // grok already known installed; checks auth.json
    return r.ok ? { deny: false } : { deny: true, reason: r.message };
  }
  return { deny: false }; // 'api' or 'unknown' → let the server decide
}

export interface HookIO {
  readStdin: () => Promise<string>;
  writeStdout: (s: string) => void;
  env: NodeJS.ProcessEnv;
  deps: AuthDeps;
}

export async function runHook(io: HookIO): Promise<void> {
  try {
    await io.readStdin(); // drain the PreToolUse payload; the decision doesn't depend on it
    const decision = decideHook(resolveHookMode(io.env), io.deps);
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
