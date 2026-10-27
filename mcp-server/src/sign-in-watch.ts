import { constants, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { grokHomeFor } from './env.js';

/**
 * A68 (docs/10) — a headless run grok turns into a browser sign-in.
 *
 * MEASURED 2026-10-27 (win32; quota 0 — a synthetic session the server rejects, every home a throwaway one; contract
 * §7 E): on grok 1.0.62, 1.0.67 and 1.0.70 alike the log shows the refresh refused (invalid_grant), auth.json deleted,
 * and the startup auth then beginning an interactive sign-in — this line in `<GROK_HOME>/logs/unified.jsonl`
 * (`src: "shell"`, `ctx.reauth: false`) — with the default browser on auth.x.ai/oauth2/authorize 13–22 ms later
 * (20 runs). After that grok waited with NOTHING on stdout or stderr (headless runs log nowhere by default) and was
 * still waiting at 340 s on all three. Through the shipped v0.2.47 bundle (1.0.70) a delegation therefore came back as `timeout` after its
 * whole timeout_ms, telling the user to raise timeout_ms. None of `CI`, `BROWSER`, `DISPLAY`, `SSH_CONNECTION`,
 * `RUST_LOG`, `GROK_LOGIN_DEVICE_FLOW`, `--no-ask-user`, `--oauth` or `--force-login` kept 1.0.70 from opening the browser
 * (one run each) — so the wrapper does not try to prevent the sign-in, it notices it.
 *
 * Only that measured shape counts: `src: "shell"`, and not `ctx.reauth: true` — a sign-in grok might begin in the middle
 * of a run is unmeasured, and stopping it could drop work the run had done, so such a run keeps ending at its cap.
 *
 * This log line is the only signal there is. It is grok's internal log, not a contract: if its path, format or message
 * changes, nothing here matches and a run is back to ending at its cap — the behaviour before this watch existed. So is
 * a run the watch misses for other reasons: the clock stepping back after the watch started, a replaced log that grows
 * past the old size before a tick reads it, a grok behind a launcher that logs another pid, or a `grok_cli` run whose
 * `--cwd` makes a relative GROK_HOME resolve somewhere other than the spawn folder (A35). Reading is fail-open for the
 * same reason: an unreadable log is a tick with nothing to see. It is also opened without blocking and read only when
 * it is a regular file — a FIFO there held a threadpool thread in open() for every watched run (pre-merge review,
 * measured on Linux; the same class as `readExactly` in delegate.ts).
 *
 * The file is shared — every grok on the machine that uses this home appends to it — so a line counts only for the pid
 * of the grok this run started, and only if its own `ts` is not before the watch started. The watch also starts reading
 * at the size the file had then, but that alone does not hold: a log replaced by a shorter one, or one whose size could
 * not be read at the start, is read from its first byte, and an earlier process with the same (reused) pid may have
 * left its line there (Grok's falsification of the first version). A line with no readable `ts` does not count — the
 * error to avoid is stopping a grok that began no sign-in.
 */
export const SIGN_IN_MESSAGE = 'auth: inline auth flow';

/** How often the log is read while grok runs. The browser opens 13–22 ms after the line, so a read is usually later. */
export const SIGN_IN_POLL_MS = 250;
/** Most bytes read in one tick: a busy shared log is caught up over several ticks instead of in one large read. */
export const SIGN_IN_READ_CAP = 1024 * 1024;
/**
 * Most of an unfinished line kept between reads — it bounds memory against a log that never ends its line. It is not a
 * matching rule: a longer line that arrives whole in one read is still read; only one split across reads past this is
 * dropped. The measured line is about 200 bytes.
 */
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
  const r = rec as { msg?: unknown; pid?: unknown; ts?: unknown; src?: unknown; ctx?: unknown };
  if (r.msg !== SIGN_IN_MESSAGE || r.pid !== pid || r.src !== 'shell') return false;
  if (typeof r.ctx === 'object' && r.ctx !== null && (r.ctx as { reauth?: unknown }).reauth === true) return false;
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
      // O_NONBLOCK: a FIFO with no writer would otherwise hold a threadpool thread here (it is 0 where it does not exist).
      const fh = await open(logPath, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
      try {
        const st = await fh.stat();
        if (!st.isFile()) return;
        const { size } = st;
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
