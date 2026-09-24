import { homedir } from 'node:os';
import { join, delimiter, posix, win32 } from 'node:path';
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

/*
 * A34 (docs/10; measured 2026-09-24 — contract §14 has the evidence and its versions): every grok
 * this module starts is a worker that runs A COPY OF THIS SERVER. grok loads installed Claude Code
 * plugins as its own — this one included — and starts their MCP servers inside each worker (every
 * recorded session that set up MCP, back to grok 1.0.13). Through that copy a worker can start yet
 * another grok: reproduced, the outer delegate reported `filesChanged: []` while the nested run
 * wrote a file in another directory, and real use tried it three times unprompted (stopped only
 * because those were plan runs).
 *
 * The copy cannot tell where it runs except from its environment, and grok hands the worker's
 * environment to the MCP servers it starts — measured for a plugin-sourced server in a headless
 * session on 1.0.30 (win32) and 1.0.41 (Linux, sandboxed or not). So every grok gets this marker,
 * and a server that finds it refuses everything — see `insideWorker` in server.ts.
 *
 * Why not switch grok's loading off instead: the only switches found (GROK_CLAUDE_MCPS_ENABLED and
 * siblings, undocumented, in the binary) disable ~/.claude.json servers only — plugin-sourced ones,
 * this one among them, are untouched (measured with `grok inspect`).
 *
 * What this still rests on: that env inheritance is GROK's behaviour, so a grok update could take it
 * away and every test here would stay green (they set the marker by hand). `npm run probe:contract`
 * re-checks it on the grok in front of you (scripts/worker-marker-probe.mjs) and fails --strict if
 * the marker stops arriving.
 */
export const WORKER_ENV_VAR = 'GROK_BUILD_WORKER';

/** True when this process was started, directly or not, by a grok that grok-build launched. */
export function insideGrokWorker(env: NodeJS.ProcessEnv): boolean {
  return env[WORKER_ENV_VAR] === '1';
}

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

/*
 * A35 (docs/10; MEASURED 2026-09-24, grok 1.0.41 on win32, `grok du --json`): grok resolves a
 * RELATIVE GROK_HOME against the directory it RUNS in — its `--cwd` when given, which wins over the
 * folder it was started in — and does not expand `~` (`~/.x` is just a relative path to it).
 * `grokHome` above hands back the raw value, so a relative one was resolved against whatever process
 * asked: the MCP server or the hook. Reproduced on the shipped v0.2.33 bundle: the session sat in
 * <task>/rel-home, and a delegation into <task> was refused in 129 ms as "not logged in" (the hook
 * denied it too) — grok never started.
 *
 * So anything that stands in for grok's own lookup asks with the folder grok will run in. A value
 * that names one place wherever grok runs is returned untouched, as before; so is the default. `~`
 * is deliberately NOT expanded: expanding it would make the plugin agree with a user's intent and
 * disagree with grok, which is the failure this fixes. With no GROK_HOME, the home comes from
 * os.homedir(), which on win32 reads USERPROFILE — and USERPROFILE moves grok's home too (measured;
 * HOME does not).
 */
export function grokHomeFor(env: NodeJS.ProcessEnv, baseDir: string, platform: NodeJS.Platform = process.platform): string {
  const raw = env.GROK_HOME;
  if (raw && raw.length > 0) {
    if (!grokHomeDependsOnFolder(raw, platform)) return raw;
    return (platform === 'win32' ? win32 : posix).resolve(baseDir, raw);
  }
  return join(homedir(), '.grok');
}

/**
 * Whether GROK_HOME names a different place depending on the folder grok runs in (A35). A relative
 * path does. So, on Windows, does a rooted path with no drive (`\x`, `/x`) and a drive with no root
 * (`C:x`): Node's isAbsolute calls the first absolute, but grok puts it on the drive of its working
 * folder (MEASURED 2026-09-24, 1.0.41, `grok du --json`: started on C: → C:\<p>\gh, on D: → D:\<p>\gh,
 * `--cwd <D: folder>` from C: → D:\<p>\gh, and the same for `/p/gh` — found by the adversarial
 * pre-merge review). A drive with its root, or a UNC/device path, names one place there.
 *
 * Classified by the leading characters, not by win32.parse().root: the first version required that
 * root to end in a separator, and a share root written without one (`\\srv\share`) failed it — the
 * re-review showed a grok_cli prompt run main denied getting through. A rooted path with no drive is
 * the absolute one that starts with exactly ONE separator; two mean UNC or a device path.
 */
export function grokHomeDependsOnFolder(raw: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'win32') return !posix.isAbsolute(raw);
  if (!win32.isAbsolute(raw)) return true; // relative, or a drive with no root (C:x)
  const isSep = (c: string | undefined) => c === '\\' || c === '/';
  return isSep(raw[0]) && !isSep(raw[1]);
}

/**
 * A sentence for an answer that depends on the folder (A35): set only when GROK_HOME does (see
 * grokHomeDependsOnFolder), naming the value and the home it resolved to from `baseDir`. Attached to
 * status and auth-check answers, and appended to a refusal (server) or deny (hook) — "run grok
 * login" alone would send the login to whatever folder the user's terminal is in.
 */
export function grokHomeNote(env: NodeJS.ProcessEnv, baseDir: string, platform: NodeJS.Platform = process.platform): string | undefined {
  const raw = env.GROK_HOME;
  if (!raw || !grokHomeDependsOnFolder(raw, platform)) return undefined;
  return `GROK_HOME('${raw}')은 상대 경로라(Windows에서는 드라이브 없는 경로도) grok이 실행되는 작업 폴더에 따라 `
    + `달라지고, ~도 풀리지 않습니다. 이 답은 ${grokHomeFor(env, baseDir, platform)} 기준입니다. 위임은 각자의 작업 `
    + '폴더 기준으로 다시 확인합니다 — 폴더마다 다른 홈을 의도한 게 아니라면 GROK_HOME을 절대 경로(Windows는 드라이브 '
    + '문자부터)로 설정하세요.';
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
  // Kept as a POSIX belt-and-braces for a launch env with no HOME at all. On win32 it does NOT
  // steer where grok looks (measured below); what decides the home on POSIX is unmeasured
  // (contract §8). Re-measured on 1.0.13 (win32, 2026-09-02) — the 2026-08-14 note that
  // grok "requires HOME or GROK_HOME" does not hold:
  //   env -u HOME -u GROK_HOME grok du --json  -> grok_home C:\Users\dirtc\.grok  (works)
  //   env -u GROK_HOME HOME=<tmp> grok du --json -> grok_home UNCHANGED
  // HOME does not relocate the config dir — GROK_HOME does (see `grokHome`), and on win32 so does
  // USERPROFILE when GROK_HOME is unset (re-measured on 1.0.41, 2026-09-24; the older note here said
  // "only GROK_HOME", which USERPROFILE disproves). Do not read this line as "HOME redirects grok" —
  // that assumption is exactly what left scripts/probe-unauth-device-flow.mjs isolating nothing
  // while believing it did.
  if (!copy.HOME && !copy.GROK_HOME) {
    copy.HOME = homedir();
  }
  copy[WORKER_ENV_VAR] = '1'; // A34 — see WORKER_ENV_VAR above
  return prependGrokBin(copy);
}
