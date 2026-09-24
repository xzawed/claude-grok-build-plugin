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
import { isAbsolute } from 'node:path';
import { checkAuth, GROK_NOT_INSTALLED_MESSAGE, type AuthDeps } from './auth.js';
import { resolveAuthMode } from './config.js';
import { grokHomeDependsOnFolder, grokHomeNote } from './env.js';
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

/*
 * AUDITED BY GROK 2026-09-22, no finding. Claim put to it: "there is a state of the world in which
 * this function allows a call that it was written to deny." Verdict False — no path returns
 * deny:false while a condition this function denies holds. Grok also read the surrounding notes
 * correctly: the residual risk here is FALSE DENIES (GROK_BIN_DIR / GROK_HOME / a server-only
 * GROK_BUILD_AUTH_MODE), which is the safe direction and the deliberate one.
 * ⚠️ That audit predates A35 (v0.2.34), which added a deliberate unchecked ALLOW: with a GROK_HOME
 * that depends on the folder and no folder to name, a readable call is let through — for grok_cli
 * that leaves grok's own check as the only one. Not re-audited against that change.
 */
export function decideHook(
  mode: HookMode,
  deps: AuthDeps,
  baseDir?: string,
  mayDefer = true,
): { deny: boolean; reason?: string } {
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
  //   - A35 (MEASURED 2026-09-24): grok resolves a RELATIVE GROK_HOME against the folder it runs in.
  //     So the session is looked for there (`baseDir`, from `runFolder`). Without that folder the
  //     hook cannot know which home grok will use — see `runFolder` for when that is — so it does
  //     not guess. For delegate/plan/verify the server's own pre-check still runs. For grok_cli there
  //     is none (see needsAuthGate), so a deferred prompt run is left to grok's own check alone —
  //     the price of never blocking a good run, paid only with a GROK_HOME that depends on the folder
  //     (grokHomeDependsOnFolder says which ones).
  //     `mayDefer` is false for a payload the hook could not read: that one is gated as before A35
  //     (FOUND BY THE PRE-MERGE REVIEW — deferring swallowed it, and needsAuthGate promises CLOSED).
  if (!deps.grokInstalled()) return { deny: true, reason: GROK_NOT_INSTALLED_MESSAGE };
  if (mode === 'subscription') {
    const home = deps.env.GROK_HOME;
    if (mayDefer && home && grokHomeDependsOnFolder(home) && baseDir === undefined) return { deny: false };
    const r = checkAuth('subscription', deps, baseDir); // grok already known installed; checks auth.json
    if (r.ok) return { deny: false };
    // "Run grok login" alone does not help when the home depends on the folder — the login lands
    // wherever the user's terminal is. Say which home was checked (set only when the home depends on
    // the folder).
    const note = baseDir === undefined ? undefined : grokHomeNote(deps.env, baseDir);
    return { deny: true, reason: note ? `${r.message} ${note}` : r.message };
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
  /** The call's own `cwd` argument, as sent (A35). */
  cwd?: string;
  /** A delegation's `worktree: true` — grok then runs in a new folder, not in `cwd` (A35). */
  worktree?: boolean;
}

/** Never throws: an unreadable payload yields an empty one, and the caller decides what that means. */
export function parseHookPayload(raw: string): HookPayload {
  try {
    const j = JSON.parse(raw) as { tool_name?: unknown; tool_input?: { args?: unknown; cwd?: unknown; worktree?: unknown } };
    const toolName = typeof j?.tool_name === 'string' ? j.tool_name : undefined;
    const rawArgs = j?.tool_input?.args;
    const args = Array.isArray(rawArgs) ? rawArgs.filter((x): x is string => typeof x === 'string') : undefined;
    const cwd = typeof j?.tool_input?.cwd === 'string' ? j.tool_input.cwd : undefined;
    const worktree = j?.tool_input?.worktree === true;
    return { toolName, args, cwd, worktree };
  } catch {
    return {};
  }
}

/**
 * A35: the folder grok will resolve a relative GROK_HOME against, when this process can name it.
 *
 * Only an absolute `cwd` names one — a relative cwd is refused by the server before anything runs.
 * Two calls name none even with one: a worktree delegation runs grok in a folder that does not exist
 * yet (the server asks about it; this process cannot), and a grok_cli call whose args carry `--cwd`
 * moves grok's folder to the flag's. MEASURED 2026-09-24 on 1.0.41 with GROK_HOME=rel-home, started
 * in folder P: `grok du --json` reported P\rel-home, `grok --cwd F du --json` reported F\rel-home.
 * Any `--cwd` token counts, even one that clap would read as some other flag's value — this only
 * decides between checking and deferring, and deferring is the side that cannot block a good run.
 */
export function runFolder(payload: HookPayload): string | undefined {
  if (payload.worktree) return undefined;
  if (payload.args?.some((t) => t === '--cwd' || t.startsWith('--cwd='))) return undefined;
  return payload.cwd !== undefined && isAbsolute(payload.cwd) ? payload.cwd : undefined;
}

/**
 * Whether this call needs the auth gate at all.
 *
 * Everything except a grok_cli call that cannot spend a subscription turn does. (That exempt set
 * is not the same as "read-only" — see prompt-flags.ts.) The default is deliberately the strict one:
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
    // An unreadable payload parses to {} — no tool name — and may not defer (see decideHook).
    const decision = needsAuthGate(payload)
      ? decideHook(resolveHookMode(io.env), io.deps, runFolder(payload), payload.toolName !== undefined)
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
    // Fail-open: a hook fault must never block a legitimate delegation.
    //
    // FOUND BY GROK auditing this seam (2026-09-23). This used to justify itself with "the
    // server-internal checkAuth remains the authoritative gate", and that reason is only true for
    // ONE of the two callers. `runGrokCli` never calls `checkAuth` — see needsAuthGate above,
    // which says so in as many words — so for a prompt-carrying passthrough there is no second
    // gate to fall back on. A fault here is an ungated turn, not a deferred check.
    //
    // The behaviour is kept, because nothing inside the try realistically throws and because a
    // hook that can hard-block every delegation is the worse failure: `parseHookPayload` is
    // documented and implemented never to throw, `resolveHookMode` returns 'unknown' rather than
    // throwing, `mayRunTurn` is pure string work, and `grokInstalled` probes with spawnSync, which
    // reports failure in its result rather than raising. The one reachable throw is the stdout
    // write on the DENY path, and by then the parent has closed the pipe.
    //
    // What actually protects the passthrough is upstream and must stay: needsAuthGate defaults to
    // TRUE for anything it cannot read, so an unparseable payload is gated rather than swallowed.
    // If you add a call inside this try, check whether it can throw before trusting this catch —
    // the old comment would have told you a backstop exists that does not.
  }
}
