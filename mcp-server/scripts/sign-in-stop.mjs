/**
 * A68 for the probes that start grok with a synthetic session: notice the moment grok begins an interactive browser
 * sign-in, and stop grok's tree — on win32 the browser it opened with it (stopTree says what POSIX leaves).
 *
 * WHY. MEASURED 2026-10-27 (win32; grok 1.0.62, 1.0.67, 1.0.70; quota 0): a headless grok whose session the server
 * rejects deletes auth.json, logs `auth: inline auth flow` to `<GROK_HOME>/logs/unified.jsonl` and 13–22 ms later opens
 * the default browser on auth.x.ai/oauth2/authorize; then it waits — still waiting at 340 s on all three. Under the probe
 * isolation that browser runs in a new profile inside the throwaway home, so it cannot use the owner's browser session —
 * but a person CAN sign in through it, and then grok holds a real token and runs the turn. The STOP probe:contract printed
 * on 2026-10-17 (`sessionAccepted`: exit 0, the marker reached, pipes closed at 125.6 s) fits only that among the paths
 * measured on the 1.0.62 binary: a rejected session waited with no MCP server started; a refused callback and a forged
 * code each ended in exit 1 with none; grok started its MCP servers only once its session was accepted; and the browser
 * it opened held its pipes until that browser was closed. The owner then confirmed signing in through that window that
 * day (2026-10-27). On win32, stopping grok's tree takes that browser with it and leaves no window to sign in through.
 *
 * The same reading as src/sign-in-watch.ts (test/sign-in-stop.test.ts holds the two to the same lines). It is grok's
 * internal log, not a contract — if it stops matching, a probe is back to running to its own cap.
 */
import { spawnSync } from 'node:child_process';
import { closeSync, constants, fstatSync, openSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const SIGN_IN_MESSAGE = 'auth: inline auth flow';
const NL = String.fromCharCode(10);
const READ_CAP = 1024 * 1024;

/** Where grok keeps that log for a home. */
export function signInLogFor(grokHome) {
  return join(grokHome, 'logs', 'unified.jsonl');
}

/**
 * Is this one log line this grok's record that it began an interactive sign-in — the measured startup shape (`src:
 * "shell"`, not `ctx.reauth: true`)? With `notBefore` (ms since the epoch) its own `ts` must also be at or after it — a
 * log read from its start (replaced, or unreadable at first) may hold a line an earlier process with the same pid left.
 */
export function isSignInLine(line, pid, notBefore) {
  if (!line.includes(SIGN_IN_MESSAGE)) return false;
  let rec;
  try { rec = JSON.parse(line); } catch { return false; }
  if (typeof rec !== 'object' || rec === null || rec.msg !== SIGN_IN_MESSAGE || rec.pid !== pid || rec.src !== 'shell') return false;
  if (typeof rec.ctx === 'object' && rec.ctx !== null && rec.ctx.reauth === true) return false;
  if (notBefore === undefined) return true;
  const at = typeof rec.ts === 'string' ? Date.parse(rec.ts) : Number.NaN;
  return at >= notBefore;
}

/**
 * Watch `logPath` from its current size; call `onSignIn` once when a complete line is `isSignInLine` for `pidOf()`,
 * stamped no earlier than this call. Call it BEFORE spawning grok. Returns `stop()`.
 */
export function watchSignIn(logPath, pidOf, onSignIn, pollMs = 250) {
  const startedAt = Date.now();
  let offset = 0;
  try { offset = statSync(logPath).size; } catch { /* not created yet */ }
  let carry = Buffer.alloc(0);
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    let fd;
    try {
      // Without O_NONBLOCK a FIFO there would block this synchronous open — the whole probe (pre-merge review).
      fd = openSync(logPath, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
      const st = fstatSync(fd);
      if (!st.isFile()) return;
      const size = st.size;
      if (size < offset) { offset = 0; carry = Buffer.alloc(0); }
      const want = Math.min(size - offset, READ_CAP);
      if (want <= 0) return;
      const buf = Buffer.alloc(want);
      const got = readSync(fd, buf, 0, want, offset);
      offset += got;
      const all = Buffer.concat([carry, buf.subarray(0, got)]);
      const end = all.lastIndexOf(10);
      carry = end === -1 ? all : all.subarray(end + 1);
      if (carry.length > 64 * 1024) carry = Buffer.alloc(0);
      if (end === -1) return;
      const pid = pidOf();
      if (pid !== undefined && all.subarray(0, end).toString('utf8').split(NL).some((l) => isSignInLine(l, pid, startedAt))) {
        stopped = true;
        clearInterval(timer);
        onSignIn();
      }
    } catch {
      // no log yet, or unreadable this time
    } finally {
      if (fd !== undefined) try { closeSync(fd); } catch { /* closed */ }
    }
  };
  const timer = setInterval(tick, pollMs);
  timer.unref?.();
  return { stop() { stopped = true; clearInterval(timer); } };
}

/**
 * Stop grok and everything it started. win32: the browser grok opens is grok's child and keeps grok's pipes open
 * (measured: the throwaway-profile Chrome held them until it was closed), so the whole tree goes. POSIX: grok's
 * process group when the caller made it a group leader (`detached`), otherwise grok alone — and a browser that a
 * desktop opener started outside grok's tree is not reached on any platform.
 *
 * Once grok's exit is recorded the platforms differ. win32 kills nothing: the pid then belongs to whatever Windows hands
 * it to next, and `taskkill /T` would take that process's whole tree (pre-merge review; this repo's own measurement
 * watcher killed an unrelated firefox.exe that way). POSIX still stops the group: a process-group id is not reissued
 * while any member of the group lives, and a member still holding grok's pipes is the reason to (the next pre-merge
 * review measured a probe held 20 s past its cap when this guard covered POSIX too; spawnBounded's grace does the same).
 * What that leaves: once every member is gone while something outside the group still holds the pipes, a new process
 * given that pid and made a group leader would be reached by a cap or an interrupt that comes later (Grok's
 * falsification, round 4).
 * grok itself is not signalled then — Node's handle is gone. If taskkill cannot run or fails, grok itself is killed.
 */
export function stopTree(child, { detached = false } = {}) {
  if (!child?.pid) return;
  const exited = child.exitCode != null || child.signalCode != null;
  if (process.platform === 'win32') {
    if (exited) return;
    const r = spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true, stdio: 'ignore' });
    if (r.error || r.status !== 0) {
      try { child.kill('SIGKILL'); } catch { /* gone */ }
    }
    return;
  }
  try {
    if (detached) process.kill(-child.pid, 'SIGKILL');
    else if (!exited) child.kill('SIGKILL');
  } catch {
    if (!exited) try { child.kill('SIGKILL'); } catch { /* gone */ }
  }
}

/**
 * Stop grok's tree when this probe is interrupted (SIGINT — Ctrl+C), terminated (SIGTERM), hung up (SIGHUP — its
 * terminal or, on win32, its console window closed) or broken (SIGBREAK — Ctrl+Break on win32), then exit with 128 plus
 * the signal's number (130, 143, 129, 149): a normal exit with that code, not a death by the signal. grok gets none of
 * these from the terminal — on POSIX a detached grok leads its own session, and on win32 a grok spawned hidden with piped
 * stdio runs in a hidden console of its own, not the probe's (measured by the pre-merge review) — and the log watch ends
 * with the probe, so a grok waiting at a sign-in would outlive it with its window open. `childOf` is asked at the moment
 * of the signal (grok may not be spawned yet). Returns the function that removes these handlers; call it on every path
 * that stops waiting for grok.
 */
export function stopTreeOnSignal(childOf, opts, exit = (code) => process.exit(code)) {
  const handlers = [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129], ['SIGBREAK', 149]]
    .map(([signal, code]) => [signal, () => { stopTree(childOf(), opts); exit(code); }]);
  for (const [signal, handler] of handlers) process.on(signal, handler);
  return () => { for (const [signal, handler] of handlers) process.off(signal, handler); };
}
