import { homedir } from 'node:os';
import { join, delimiter } from 'node:path';
import type { AuthMode } from './types.js';

/*
 * The pay-as-you-go credentials a subscription run must not hold.
 *
 * FOUND BY GROK auditing this file (2026-09-22): the deletion below is the single most
 * consequential thing this module does and it was the only thing here with no comment, while the
 * HOME fallback eight lines down carried a measured eight-line rationale. Verified — the reasoning
 * existed only in root CLAUDE.md, which by its own header is NOT delivered to installed users and
 * loads only when developing in this repo. So whoever read the shipped source, or reviewed a diff
 * to this file, saw an unexplained `delete`.
 *
 * WHY (SSOT: docs/02-auth-strategy.md, and grok-cli-contract.md §10 for the measurement):
 * it is NOT that the key would outrank a live session — measured on 1.0.13, grok goes
 * `auth_type=SessionToken` and never tries the env key while a session is valid. It is that the
 * moment the session is absent or expired, an env key becomes a FALLBACK credential and a run the
 * user believes is on their subscription is silently billed as metered API usage. Stripping the
 * keys converts that silent charge into an explicit `auth_error`. Subscription mode therefore
 * never holds a metered credential at all — a policy guarantee, not an optimisation.
 *
 * Pinned by test/env.test.ts (both modes, mixed case, and the api-mode passthrough). If you are
 * here to simplify this loop: removing it re-opens silent metered billing, and the tests will say
 * so before CI does.
 */
const API_KEY_VARS = ['XAI_API_KEY', 'GROK_CODE_XAI_API_KEY'] as const;
// Case-insensitive on purpose: Windows env vars are case-insensitive, so a `xai_api_key` set in a
// user shell would survive an exact-match filter and become exactly the fallback described above.
const API_KEY_VARS_LOWER = new Set(API_KEY_VARS.map((k) => k.toLowerCase()));

// grok's config dir. `GROK_HOME` relocates it wholesale — grok's own README documents
// "GROK_HOME — Override config directory (default: ~/.grok)". Measured on 1.0.5 (2026-09-02)
// and re-measured unchanged on 1.0.13 (2026-09-03):
// `GROK_HOME=<dir> grok du --json` reports grok_home=<dir> while auth resolves
// ONLY there: `grok models` under a fresh GROK_HOME says "not authenticated" even with a valid
// ~/.grok/auth.json. There is no fallback, so anything looking for grok state must ask here.
// Deliberately independent of grokBinDir: the binary's location comes from GROK_BIN_DIR /
// install.sh, which GROK_HOME was not measured to move.
export function grokHome(env: NodeJS.ProcessEnv): string {
  return env.GROK_HOME && env.GROK_HOME.length > 0
    ? env.GROK_HOME
    : join(homedir(), '.grok');
}

// grok's install.sh puts the binary in $GROK_BIN_DIR (default $HOME/.grok/bin) and adds
// that dir to PATH in shell profiles. A GUI/Dock-launched Claude Code doesn't source those
// profiles, so its PATH — inherited by the MCP server and hook subprocesses — may omit it.
export function grokBinDir(env: NodeJS.ProcessEnv): string {
  return env.GROK_BIN_DIR && env.GROK_BIN_DIR.length > 0
    ? env.GROK_BIN_DIR
    : join(homedir(), '.grok', 'bin');
}

// Returns a copy of env with the grok bin dir prepended to PATH so `grok` is discoverable
// even under a minimal PATH. Idempotent (skips if already present); does not mutate input.
// The PATH key is located case-insensitively: Windows spells it `Path`, and writing a fresh
// uppercase `PATH` beside it leaves two keys that differ only in case. The child process
// keeps only one of them, so the real PATH is silently dropped and grok inherits nothing but
// its own bin dir. Mirrors the case-insensitive handling buildGrokEnv already uses for keys.
export function prependGrokBin(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const dir = grokBinDir(env);
  // When both spellings somehow coexist in a hand-built env, prefer the exact uppercase
  // key: measured on win32 that is the one the child process keeps.
  const pathKey = Object.hasOwn(env, 'PATH')
    ? 'PATH'
    : Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  const current = env[pathKey] ?? '';
  const parts = current.split(delimiter).filter(Boolean);
  if (parts.includes(dir)) return { ...env };
  return { ...env, [pathKey]: current ? `${dir}${delimiter}${current}` : dir };
}

export function buildGrokEnv(
  mode: AuthMode,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const copy: NodeJS.ProcessEnv = { ...env };
  if (mode === 'subscription') {
    for (const key of Object.keys(copy)) {
      if (API_KEY_VARS_LOWER.has(key.toLowerCase())) delete copy[key];
    }
  }
  // Kept as a POSIX belt-and-braces for a launch env with no HOME at all; it does NOT steer
  // where grok looks. Re-measured on 1.0.13 (win32, 2026-09-02) — the 2026-08-14 note that
  // grok "requires HOME or GROK_HOME" does not hold:
  //   env -u HOME -u GROK_HOME grok du --json  -> grok_home C:\Users\dirtc\.grok  (works)
  //   env -u GROK_HOME HOME=<tmp> grok du --json -> grok_home UNCHANGED
  // Only GROK_HOME relocates the config dir (see `grokHome`). Do not read this line as
  // "HOME redirects grok" — that assumption is exactly what left scripts/probe-unauth-
  // device-flow.mjs isolating nothing while believing it did.
  if (!copy.HOME && !copy.GROK_HOME) {
    copy.HOME = homedir();
  }
  return prependGrokBin(copy);
}
