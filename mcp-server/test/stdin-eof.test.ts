/**
 * MCP 2.0 plan, Review Focus 3: the client closes the server's stdin while a delegation is running. The server must
 * end, and the grok it started must not be left behind — the same life as the SDK v1 bundle's. MEASURED 2026-11-28 on
 * win32 with a stand-in grok that sleeps 20 s (quota 0; stdin closed as soon as the stand-in was seen to start): the
 * v0.2.55 bundle (SDK v1) exited with code 0 20.4 s after it was started — once grok had ended, which it did on its own — wrote the
 * history row, and still answered the call; the v2 bundle did the same in both eras except that it wrote no answer:
 * its transport is closed by then (docs/04 — so does every call still running at stdin EOF). This file checks that
 * too, so a client keeps stdin open until it has read its answers.
 *
 * The stand-in grok sends no request anywhere: on win32 a tiny program compiled here with the .NET Framework's csc
 * (the spawn looks for grok.exe, never a script; the case is skipped where csc is missing), elsewhere a shell script.
 * It records its start and end and exits by itself after its sleep, so nothing here has to kill it. The real grok
 * cannot be found (the acceptance grader's isolation), and the home is throwaway, with a placeholder auth.json.
 */
import { describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSession } from '../../.claude/tools/rpc-era.mjs';
import { isolate } from '../../.claude/tools/accept-checks.mjs';
import { bundlePath } from './bundle-client.js';

const SLEEP_MS = 4_000;
const win = process.platform === 'win32';
const csc = join(process.env.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');

const FAKE_CS = String.raw`
using System;
using System.IO;
using System.Threading;
class FakeGrok {
  static void Log(string what) {
    var log = Environment.GetEnvironmentVariable("FAKE_GROK_LOG");
    if (log != null) File.AppendAllText(log, what + " pid=" + System.Diagnostics.Process.GetCurrentProcess().Id + "\n");
  }
  static int Main(string[] args) {
    if (Array.IndexOf(args, "--version") >= 0) { Console.WriteLine("grok 1.0.92 (stand-in)"); return 0; }
    Log("start");
    int ms;
    if (!int.TryParse(Environment.GetEnvironmentVariable("FAKE_GROK_SLEEP_MS"), out ms)) ms = 4000;
    Thread.Sleep(ms);
    Console.WriteLine("{\"type\":\"result\",\"result\":\"stand-in done\"}");
    Log("end");
    return 0;
  }
}
`;
const FAKE_SH = `#!/bin/sh
for a in "$@"; do [ "$a" = "--version" ] && { echo "grok 1.0.92 (stand-in)"; exit 0; }; done
[ -n "$FAKE_GROK_LOG" ] && echo "start pid=$$" >> "$FAKE_GROK_LOG"
sleep $(( \${FAKE_GROK_SLEEP_MS:-4000} / 1000 ))
echo '{"type":"result","result":"stand-in done"}'
[ -n "$FAKE_GROK_LOG" ] && echo "end pid=$$" >> "$FAKE_GROK_LOG"
exit 0
`;

/** The stand-in in its own folder (that folder becomes GROK_BIN_DIR), or undefined when it cannot be built here. */
function buildStandIn(dir: string): string | undefined {
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  if (win) {
    if (!existsSync(csc)) return undefined;
    const src = join(dir, 'fake-grok.cs');
    writeFileSync(src, FAKE_CS);
    const r = spawnSync(csc, ['/nologo', `/out:${join(bin, 'grok.exe')}`, src], { encoding: 'utf8' });
    return r.status === 0 && existsSync(join(bin, 'grok.exe')) ? bin : undefined;
  }
  writeFileSync(join(bin, 'grok'), FAKE_SH);
  chmodSync(join(bin, 'grok'), 0o755);
  return bin;
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const scratch = mkdtempSync(join(tmpdir(), 'stdin-eof-'));
const standIn = buildStandIn(scratch);

describe('stdin closed mid-delegation (MCP 2.0 plan, Review Focus 3)', () => {
  it.skipIf(standIn === undefined).each(['legacy', 'modern'] as const)('%s era: the server ends once grok has, grok is not left behind, the row is written, and no answer comes', async (era) => {
    const iso = isolate();
    const root = mkdtempSync(join(scratch, `${era}-`));
    const home = join(root, 'home');
    mkdirSync(join(home, '.grok'), { recursive: true });
    writeFileSync(join(home, '.grok', 'auth.json'), '{}');
    const cwd = join(root, 'cwd');
    mkdirSync(cwd);
    const log = join(root, 'stand-in.log');
    const env: Record<string, string | undefined> = {
      ...iso.baseEnv, HOME: home, USERPROFILE: home, GROK_HOME: join(home, '.grok'), CLAUDE_CONFIG_DIR: join(home, '.claude'),
      GROK_BIN_DIR: standIn, FAKE_GROK_LOG: log, FAKE_GROK_SLEEP_MS: String(SLEEP_MS), GROK_BUILD_AUTH_MODE: 'subscription',
      GROK_BUILD_WORKER: undefined,
    };
    const server = spawn(process.execPath, [bundlePath], { env, cwd: iso.work, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const exited = new Promise<{ code: number | null; fakeAlive: boolean }>((resolve) => {
      server.once('exit', (code) => {
        const started = existsSync(log) ? /start pid=(\d+)/.exec(readFileSync(log, 'utf8')) : null;
        resolve({ code, fakeAlive: started ? alive(Number(started[1])) : false });
      });
    });
    try {
      const s = await openSession(server, era, { timeoutFor: () => 60_000 });
      const reply = s.request('tools/call', { name: 'grok_build_delegate', arguments: { prompt: 'Say hi.', cwd, timeout_ms: 60_000 } })
        .catch((e: Error) => ({ rejected: e.message }));
      for (let i = 0; i < 80 && !(existsSync(log) && readFileSync(log, 'utf8').includes('start')); i++) await sleep(250);
      expect(readFileSync(log, 'utf8'), 'the stand-in grok never started').toContain('start');
      const closedAt = Date.now();
      server.stdin.end();
      const end = await Promise.race([exited, sleep(SLEEP_MS + 30_000).then(() => undefined)]);
      expect(end, 'the server did not end after its stdin closed').toBeDefined();
      expect(end?.code).toBe(0);
      // grok ran to its own end and did not outlive the server
      expect(readFileSync(log, 'utf8')).toContain('end');
      expect(end?.fakeAlive).toBe(false);
      expect(Date.now() - closedAt).toBeGreaterThanOrEqual(SLEEP_MS - 1_500);
      const hist = join(home, '.grok-build', 'history.jsonl');
      expect(existsSync(hist) ? readFileSync(hist, 'utf8').split('\n').filter(Boolean).length : 0).toBe(1);
      // the transport closed with stdin: the server ended without writing this call's answer (v1 wrote it)
      expect(await reply).toEqual({ rejected: expect.stringMatching(/^server exited before answering \(code=0/) });
    } finally {
      if (server.exitCode === null) server.kill();
      iso.cleanup();
    }
  }, SLEEP_MS + 60_000);

  it('cleans up', () => {
    rmSync(scratch, { recursive: true, force: true });
    expect(existsSync(scratch)).toBe(false);
  });
});
