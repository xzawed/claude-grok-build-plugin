import { statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { grokHomeFor } from './env.js';

/**
 * A68 (docs/10) — a headless run grok turns into a browser sign-in.
 *
 * MEASURED 2026-10-27 (win32; grok 1.0.62, 1.0.67 and 1.0.70; quota 0 — a synthetic session the server rejects, every
 * home a throwaway one): grok's refresh is refused (invalid_grant), it deletes auth.json, and its startup auth then
 * begins an interactive sign-in — this line in `<GROK_HOME>/logs/unified.jsonl`, then the default browser on
 * auth.x.ai/oauth2/authorize about 20 ms later. After that grok waits with NOTHING on stdout or stderr (headless runs
 * log nowhere by default) and was still waiting at 340 s on all three versions. Through the shipped v0.2.47 bundle a
 * delegation therefore came back as `timeout` after its whole timeout_ms, telling the user to raise timeout_ms.
 * None of `CI`, `BROWSER`, `DISPLAY`, `SSH_CONNECTION`, `RUST_LOG`, `GROK_LOGIN_DEVICE_FLOW`, `--no-ask-user`, `--oauth`
 * or `--force-login` kept grok from opening the browser — so the wrapper does not try to prevent the sign-in, it
 * notices it.
 *
 * This log line is the only signal there is. It is grok's internal log, not a contract: if its path, format or message
 * changes, nothing here matches and a run is back to ending at its cap — the behaviour before this watch existed.
 * Reading is fail-open for the same reason: an unreadable log is a tick with nothing to see.
 *
 * The file is shared — every grok on the machine that uses this home appends to it — so a line counts only for the pid
 * of the grok this run started, and only if its own `ts` is not before the watch started. The watch also starts reading
 * at the size the file had then, but that alone does not hold: a log replaced by a shorter one, or one whose size could
 * not be read at the start, is read from its first byte, and an earlier process with the same (reused) pid may have
 * left its line there (Grok's falsification of the first version). A line with no readable `ts` does not count — the
 * error to avoid is stopping a grok that began no sign-in.
 */
export const SIGN_IN_MESSAGE = 'auth: inline auth flow';

/** How often the log is read while grok runs. The browser opens ~20 ms after the line — no poll can beat it. */
export const SIGN_IN_POLL_MS = 250;
/** Most bytes read in one tick: a busy shared log is caught up over several ticks instead of in one large read. */
export const SIGN_IN_READ_CAP = 1024 * 1024;
/** A line longer than this is not a log record of the kind looked for; the unfinished rest is dropped, not kept. */
const LINE_CAP = 64 * 1024;

/** Where grok keeps that log for a home. */
export function signInLogFor(grokHomeDir: string): string {
  return join(grokHomeDir, 'logs', 'unified.jsonl');
}

/** The log of the grok that runs with `env` in `cwd` — the home is asked for the way the rest of the wrapper asks (A35·A36). */
export function signInLogForRun(env: NodeJS.ProcessEnv, cwd: string): string {
  return signInLogFor(grokHomeFor(env, cwd));
}

/**
 * Pure: is this one log line THIS grok's record that it began an interactive sign-in? With `notBefore` (ms since the
 * epoch) the record's own `ts` must also be a time at or after it.
 */
export function isSignInLine(line: string, pid: number, notBefore?: number): boolean {
  if (!line.includes(SIGN_IN_MESSAGE)) return false;
  let rec: unknown;
  try { rec = JSON.parse(line); } catch { return false; }
  if (typeof rec !== 'object' || rec === null) return false;
  const r = rec as { msg?: unknown; pid?: unknown; ts?: unknown };
  if (r.msg !== SIGN_IN_MESSAGE || r.pid !== pid) return false;
  if (notBefore === undefined) return true;
  const at = typeof r.ts === 'string' ? Date.parse(r.ts) : Number.NaN;
  return at >= notBefore;
}

/**
 * Read what is appended to `logPath` from now on and call `onSignIn` once, the first time a complete line is
 * `isSignInLine` for `pidOf()`, stamped no earlier than this call. The starting size and time are taken synchronously,
 * here — call it BEFORE spawning grok, so no line grok writes is behind the starting point. Lines read while `pidOf()`
 * is still undefined are not matched.
 */
export function startSignInWatch(
  logPath: string, pidOf: () => number | undefined, onSignIn: () => void, pollMs: number = SIGN_IN_POLL_MS,
): { stop(): void } {
  const startedAt = Date.now();
  let offset = 0;
  try { offset = statSync(logPath).size; } catch { /* not created yet: grok's first line is at 0 */ }
  let carry = '';
  let decoder = new StringDecoder('utf8');
  let stopped = false;
  let busy = false;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const fh = await open(logPath, 'r');
      try {
        const { size } = await fh.stat();
        if (size < offset) { offset = 0; carry = ''; decoder = new StringDecoder('utf8'); } // replaced or truncated
        const want = Math.min(size - offset, SIGN_IN_READ_CAP);
        if (want <= 0) return;
        const buf = Buffer.alloc(want);
        const { bytesRead } = await fh.read(buf, 0, want, offset);
        offset += bytesRead;
        const lines = (carry + decoder.write(buf.subarray(0, bytesRead))).split('\n');
        carry = lines.pop() ?? '';
        if (carry.length > LINE_CAP) carry = '';
        const pid = pidOf();
        if (!stopped && pid !== undefined && lines.some((l) => isSignInLine(l, pid, startedAt))) {
          stopped = true;
          clearInterval(timer);
          onSignIn();
        }
      } finally {
        await fh.close();
      }
    } catch {
      // no log yet, or it could not be read this time: nothing seen
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, pollMs);
  timer.unref?.();
  return { stop() { stopped = true; clearInterval(timer); } };
}
