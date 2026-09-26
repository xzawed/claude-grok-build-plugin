import { describe, it, expect } from 'vitest';
import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { runGrokCli, isBlockedGrokCommand, extractPromptRun, unknownGrokSubcommand, defaultFolderStarts, MAX_STDOUT_CHARS, STDOUT_TAIL_CHARS, type GrokCliDeps } from '../src/grok-cli.js';
import { mayRunTurn } from '../src/prompt-flags.js';
import type { SpawnFn, SpawnResult } from '../src/delegate.js';

const fakeSpawn = (r: Partial<SpawnResult>, cap?: (a: string[], e: NodeJS.ProcessEnv) => void): SpawnFn =>
  async (args, _cwd, env) => { cap?.(args, env); return { code: 0, stdout: '', stderr: '', timedOut: false, ...r }; };
const deps = (spawnR: Partial<SpawnResult>, env: NodeJS.ProcessEnv = {}, cap?: (a: string[], e: NodeJS.ProcessEnv) => void): GrokCliDeps =>
  ({ spawn: fakeSpawn(spawnR, cap), env });

describe('isBlockedGrokCommand', () => {
  it('blocks non-headless commands', () => {
    for (const c of ['dashboard', 'agent', 'leader', 'completions', 'wrap']) {
      expect(isBlockedGrokCommand([c])).toBe(true);
    }
  });
  it('blocks login entirely (device URL cannot be surfaced through the buffered spawn)', () => {
    expect(isBlockedGrokCommand(['login'])).toBe(true);
    expect(isBlockedGrokCommand(['login', '--device-auth'])).toBe(true);
  });
  it('blocks import (not a 1.0 subcommand — would start the TUI)', () => {
    expect(isBlockedGrokCommand(['import'])).toBe(true);
    expect(isBlockedGrokCommand(['--cwd', '/tmp', 'import', 'foo'])).toBe(true);
  });
  // A29, MEASURED 2026-09-22 through the SHIPPED v0.2.25 bundle on grok 1.0.30:
  //   grok_cli {"args":["cursor-worker","--help"]}             -> status blocked   (unknown-subcommand rule)
  //   grok_cli {"args":["--minimal","cursor-worker","--help"]} -> status ok, exit 0, IT SPAWNED
  // A leading flag the VALUE_FLAGS snapshot does not know degrades the parse to "uncertain", and
  // `unknownGrokSubcommand` then stands down BY DESIGN (a stale allowlist must not false-block).
  // So the only protection `cursor-worker` had was the allowlist — the one that fails open.
  // `grok cursor-worker start` registers this machine as a Cursor private worker that holds Cloud
  // Agent claims, running through the same `leader` daemon already in NON_HEADLESS. It belongs in
  // the DENYLIST, which the same measurement shows survives the flag prefix:
  //   grok_cli {"args":["--minimal","leader","list"]} -> status blocked
  it('blocks cursor-worker — and keeps blocking it behind an unrecognised flag (A29)', () => {
    expect(isBlockedGrokCommand(['cursor-worker'])).toBe(true);
    expect(isBlockedGrokCommand(['cursor-worker', 'start'])).toBe(true);
    expect(isBlockedGrokCommand(['--minimal', 'cursor-worker', 'start'])).toBe(true);
  });
  it('allows normal utility commands', () => {
    expect(isBlockedGrokCommand(['sessions', 'list'])).toBe(false);
    expect(isBlockedGrokCommand(['models'])).toBe(false);
  });
  it('detects a blocked subcommand behind leading global flags (no args[0] bypass)', () => {
    expect(isBlockedGrokCommand(['--cwd', '/tmp', 'login'])).toBe(true);
    expect(isBlockedGrokCommand(['--cwd', '/tmp', 'dashboard'])).toBe(true);
    expect(isBlockedGrokCommand(['--output-format', 'json', 'agent'])).toBe(true);
    expect(isBlockedGrokCommand(['--model=grok-4.5', 'login'])).toBe(true);
  });
  it('does not false-block a blocked word that is a flag value (e.g. a -p prompt)', () => {
    expect(isBlockedGrokCommand(['-p', 'login'])).toBe(false);
    expect(isBlockedGrokCommand(['-p', 'add a login page'])).toBe(false);
    expect(isBlockedGrokCommand(['--cwd', '/tmp', 'sessions', 'list'])).toBe(false);
  });

  // Measured on grok 1.0.5 (2026-09-02): `grok --sandbox workspace version` parses as
  // flag-value + COMMAND and exits 0. These flags take a value but were missing from
  // VALUE_FLAGS, so their value was mistaken for the subcommand and the real one behind it
  // was never examined — the denylist failed OPEN, the opposite of what its comment claimed.
  it('blocks a non-headless command hidden behind a value flag missing from the snapshot', () => {
    expect(isBlockedGrokCommand(['--sandbox', 'workspace', 'dashboard'])).toBe(true);
    expect(isBlockedGrokCommand(['--tools', 'read', 'wrap'])).toBe(true);
    expect(isBlockedGrokCommand(['--system-prompt-override', 'hi', 'login'])).toBe(true);
    expect(isBlockedGrokCommand(['--worktree-ref', 'main', 'leader'])).toBe(true);
    expect(isBlockedGrokCommand(['--ref', 'main', 'wrap'])).toBe(true);
    expect(isBlockedGrokCommand(['--system-prompt', 'x', 'login'])).toBe(true);
    expect(isBlockedGrokCommand(['--allowedTools', 'x', 'dashboard'])).toBe(true);
    expect(isBlockedGrokCommand(['--disallowedTools', 'x', 'agent'])).toBe(true);
  });

  // The durable property: the flag snapshot WILL go stale again (this repo tracks a CLI it
  // does not ship). Blocking must not depend on knowing every value flag, so a denylisted
  // word is refused wherever it lands among the positionals.
  it('still blocks when the preceding flag is unknown to the snapshot', () => {
    expect(isBlockedGrokCommand(['--a-flag-added-after-1.0.5', 'value', 'dashboard'])).toBe(true);
  });

  it('does not over-block ordinary positionals after an unknown flag', () => {
    expect(isBlockedGrokCommand(['--a-flag-added-after-1.0.5', 'value', 'sessions', 'list'])).toBe(false);
    expect(isBlockedGrokCommand(['--sandbox', 'workspace', 'sessions', 'list'])).toBe(false);
  });

  // Scanning EVERY positional unconditionally refused a reserved word used as an ordinary
  // ARGUMENT. `/grok:sessions` sends a user-supplied query, and grok 1.0.13 runs
  // `sessions search dashboard` happily (measured: 1 hit). When nothing ambiguous precedes
  // the first positional, that token IS the subcommand and the rest are its arguments —
  // there is nothing left to smuggle, so only the subcommand slot needs checking.
  it('allows a reserved word used as an argument of an unambiguous subcommand', () => {
    expect(isBlockedGrokCommand(['sessions', 'search', 'dashboard'])).toBe(false);
    expect(isBlockedGrokCommand(['sessions', 'search', 'login'])).toBe(false);
    expect(isBlockedGrokCommand(['export', 'dashboard'])).toBe(false);
    expect(isBlockedGrokCommand(['--cwd', '/tmp', 'sessions', 'search', 'agent'])).toBe(false);
  });

  // The trust is conditional: a bare flag the snapshot does not know might have swallowed
  // the next token, so the first positional may not be the subcommand at all. That is the
  // fail-open this fix exists to close, and it must survive the relaxation above.
  it('still scans every positional once an unrecognised flag makes the parse ambiguous', () => {
    expect(isBlockedGrokCommand(['--a-flag-added-after-1.0.5', 'value', 'dashboard'])).toBe(true);
    // the nastiest shape: the unknown flag's value happens to look like a real subcommand
    expect(isBlockedGrokCommand(['--a-flag-added-after-1.0.5', 'version', 'dashboard'])).toBe(true);
    // -r/--resume and -w/--worktree take an OPTIONAL value, so they stay out of VALUE_FLAGS.
    // Refusing them is correct for a different reason: measured on 1.0.13, `grok --resume x`
    // with no -p opens the interactive TUI, which this buffered spawn can only time out on.
    expect(isBlockedGrokCommand(['-r', 'dashboard'])).toBe(true);
    expect(isBlockedGrokCommand(['--worktree', 'dashboard'])).toBe(true);
  });
});

describe('runGrokCli', () => {
  it('rejects a relative cwd without spawning (matches the runDelegate guard)', async () => {
    let spawned = false;
    const r = await runGrokCli(
      'subscription',
      ['sessions', 'list'],
      {
        spawn: async () => {
          spawned = true;
          return { code: 0, stdout: '', stderr: '', timedOut: false };
        },
        env: {},
      },
      { cwd: 'relative/dir' },
    );
    // A relative cwd would resolve against the MCP server's own directory, not the
    // user's project, and surface as a misleading "grok 실행에 실패했습니다" spawn error.
    expect(spawned).toBe(false);
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/절대 경로/);
  });
  it('still accepts an absolute cwd', async () => {
    let seenCwd = '';
    const r = await runGrokCli(
      'subscription',
      ['models'],
      {
        spawn: async (_a, cwd) => {
          seenCwd = cwd;
          return { code: 0, stdout: '', stderr: '', timedOut: false };
        },
        env: {},
      },
      { cwd: process.cwd() },
    );
    expect(r.status).toBe('ok');
    expect(seenCwd).toBe(process.cwd());
  });
  it('blocked command returns status blocked without spawning', async () => {
    let spawned = false;
    const r = await runGrokCli('subscription', ['dashboard'], {
      spawn: async () => { spawned = true; return { code: 0, stdout: '', stderr: '', timedOut: false }; },
      env: {},
    });
    expect(r.status).toBe('blocked');
    expect(spawned).toBe(false);
  });
  it('names the word it actually blocked, not the first positional', async () => {
    const r = await runGrokCli('subscription', ['--a-flag-added-after-1.0.5', 'value', 'dashboard'], {
      spawn: async () => { throw new Error('must not spawn'); },
      env: {},
    });
    expect(r.status).toBe('blocked');
    expect(r.message).toContain('dashboard');
    expect(r.message).not.toContain('value');
  });
  it('import is blocked with a missing-subcommand message (no spawn)', async () => {
    let spawned = false;
    const r = await runGrokCli('subscription', ['import', './x.json'], {
      spawn: async () => { spawned = true; return { code: 0, stdout: '', stderr: '', timedOut: false }; },
      env: {},
    });
    expect(r.status).toBe('blocked');
    expect(r.message).toMatch(/import/);
    expect(r.message).toMatch(/1\.0/);
    expect(spawned).toBe(false);
  });
  it('prepends --no-auto-update and applies billing-safe env (subscription strips keys)', async () => {
    let capArgs: string[] = []; let capEnv: NodeJS.ProcessEnv = {};
    await runGrokCli('subscription', ['models'], deps({ code: 0, stdout: 'gpt' }, { XAI_API_KEY: 'sk', PATH: '/usr/bin' }, (a, e) => { capArgs = a; capEnv = e; }));
    expect(capArgs[0]).toBe('--no-auto-update');
    expect(capArgs).toContain('models');
    expect(capEnv.XAI_API_KEY).toBeUndefined();
  });
  it('api mode passes keys through and reports metered_api billing', async () => {
    let capEnv: NodeJS.ProcessEnv = {};
    const r = await runGrokCli('api', ['models'], deps({ code: 0 }, { XAI_API_KEY: 'sk' }, (_a, e) => { capEnv = e; }));
    expect(capEnv.XAI_API_KEY).toBe('sk');
    expect(r.billing).toBe('metered_api');
  });
  // A34: a `-p` passthrough is a worker turn exactly like a delegation, and grok loads this plugin
  // into it. The env is built once for every spawn here, so a read-only call pins the same path
  // without running git in the test runner's cwd.
  it('A34: spawns grok with the grok-build worker marker', async () => {
    let capEnv: NodeJS.ProcessEnv = {};
    await runGrokCli('subscription', ['models'], deps({ code: 0, stdout: 'ok' }, { PATH: '/usr/bin' }, (_a, e) => { capEnv = e; }));
    expect(capEnv.GROK_BUILD_WORKER).toBe('1');
  });
  it('exit 0 -> ok, non-zero -> error, timeout -> timeout', async () => {
    expect((await runGrokCli('subscription', ['models'], deps({ code: 0 }))).status).toBe('ok');
    expect((await runGrokCli('subscription', ['models'], deps({ code: 1, stderr: 'boom' }))).status).toBe('error');
    expect((await runGrokCli('subscription', ['models'], deps({ timedOut: true, code: null }))).status).toBe('timeout');
  });
  it('timeout preserves the captured stdout/stderr tails (not discarded)', async () => {
    const r = await runGrokCli('subscription', ['export', 'big'], deps({ timedOut: true, code: null, stdout: 'partial output', stderr: 'warn' }));
    expect(r.status).toBe('timeout');
    expect(r.stdoutTail).toContain('partial output');
    expect(r.stderrTail).toContain('warn');
  });
  it('spawnError -> error', async () => {
    const r = await runGrokCli('subscription', ['models'], deps({ spawnError: true, code: null }));
    expect(r.status).toBe('error');
  });
  // Round 6 (from a Grok classification): A39 turned every start failure into this structured error, and it said
  // "설치/PATH 확인" for all of them — v0.2.35 returned ENAMETOOLONG and a NUL in an argument bare, and ended the
  // server on EMFILE. Measured through the bundles on win32: a 40,000-character argument read "spawn ENAMETOOLONG"
  // on v0.2.35 and "grok 실행에 실패했습니다 (설치/PATH 확인)." on the round-5 fix (557d36e); so did a NUL.
  // Round 7: every `spawn …` text below is what Node produced on win32 or Linux in the review's runs (the last line is
  // spawnBounded's own fallback, for a pipe-less child whose 'error' has not arrived by the next turn), and the code is
  // read from Node's fixed wording — the NUL error QUOTES the argument, and one holding "EACCES" read as the install.
  it.each([
    'spawn E2BIG', 'spawn grok EMFILE', 'spawn grok EAGAIN', 'spawn EBUSY', 'spawn ETXTBSY',
    "The argument 'args[2]' must be a string without null bytes. Received 'a\\x00b'",
    "The argument 'args[2]' must be a string without null bytes. Received 'why does npm fail with EACCES on install?\\x00'",
    'grok could not be started: no stdio pipes',
  ])('a start that failed for another reason names that reason: %s', async (stderr) => {
    const r = await runGrokCli('subscription', ['models'], deps({ spawnError: true, code: -1, stderr }));
    expect(r.status).toBe('error');
    expect(r.message).toBe(`grok 실행에 실패했습니다: ${stderr}`);
  });
  // A grok that is missing, or found but not a program this machine will run (rounds 7 to 9, each measured): a
  // missing, `.cmd`-only or dangling grok and a bad interpreter line (ENOENT); missing with a file as the last PATH
  // entry (ENOTDIR, Linux); no execute permission, a directory named grok, a noexec mount (EACCES); an ACL that denies
  // execute (EPERM); a zero-byte, truncated or IA64 grok.exe (EFTYPE); a text or ARM64 grok.exe (UNKNOWN); a zero-byte
  // or truncated grok on musl (ENOEXEC); a symlink loop (ELOOP). The round-6 fix named EFTYPE, UNKNOWN and ELOOP raw,
  // and the round-7 fix ENOTDIR and ENOEXEC.
  it.each(['spawn grok ENOENT', 'spawn ENOTDIR', 'spawn grok EACCES', 'spawn EPERM', 'spawn EFTYPE', 'spawn UNKNOWN',
    'spawn ENOEXEC', 'spawn ELOOP', ''])(
    'a grok that is missing or will not run points at the install: %j', async (stderr) => {
      const r = await runGrokCli('subscription', ['models'], { ...deps({ spawnError: true, code: -1, stderr }), folderStarts: () => true });
      expect(r.message).toBe('grok 실행에 실패했습니다 (설치/PATH 확인).');
    });
  // ENAMETOOLONG: on Windows an argument too long for the command line — named; elsewhere arguments give E2BIG and it
  // comes from grok's PATH (a folder name over 255 bytes, or a path over 4,096) — the install. v0.2.35 and rounds 6 to
  // 8 showed it raw everywhere; the code before the review and round 5 pointed at the install everywhere (round 9;
  // v0.2.35 measured in round 10).
  it.each([
    ['win32', 'grok 실행에 실패했습니다: spawn ENAMETOOLONG'],
    ['linux', 'grok 실행에 실패했습니다 (설치/PATH 확인).'],
    ['darwin', 'grok 실행에 실패했습니다 (설치/PATH 확인).'],
  ] as const)('ENAMETOOLONG on %s', async (platform, expected) => {
    const r = await runGrokCli('subscription', ['models'], { ...deps({ spawnError: true, code: -1, stderr: 'spawn ENAMETOOLONG' }), folderStarts: () => true, platform });
    expect(r.message).toBe(expected);
  });
  // A code a working folder can cause is put to that folder first: one the user may not enter (EACCES on Linux —
  // round 7), one replaced by a file or removed after the check (ENOTDIR, ENOENT — round 9), a looping link (ELOOP).
  // For EACCES every version before round 7 said "설치/PATH 확인"; a file or a loop there (ENOTDIR, ELOOP) was shown raw
  // by v0.2.35 and round 6 (round 10). The check is asked about THIS folder (round 8: a check of the server's own
  // folder passed every test that ignored its argument).
  it.each(['spawn grok EACCES', 'spawn grok ENOENT', 'spawn ENOTDIR', 'spawn ELOOP'])(
    'a working folder no process can start in is named, not the install: %s', async (stderr) => {
      const cwd = tmpdir();
      const r = await runGrokCli('subscription', ['models'],
        { ...deps({ spawnError: true, code: -1, stderr }), folderStarts: (dir) => dir !== cwd }, { cwd });
      expect(r.message).toBe(`grok 실행에 실패했습니다: 작업 폴더에서 프로세스를 시작할 수 없습니다(${stderr.split(' ').pop()}) — ${cwd}`);
    });
  it.each([
    ['spawn grok EMFILE', 'grok 실행에 실패했습니다: spawn grok EMFILE'],
    ['spawn EFTYPE', 'grok 실행에 실패했습니다 (설치/PATH 확인).'],
  ])('the folder is asked only for codes a folder can cause: %s', async (stderr, expected) => {
    const r = await runGrokCli('subscription', ['models'],
      { ...deps({ spawnError: true, code: -1, stderr }), folderStarts: () => false }, { cwd: tmpdir() });
    expect(r.message).toBe(expected);
  });
  // A folder no process could enter within the check's cap is named first — a slow or hung mount — with the install as
  // the fallback (round 11 — pointed at the install alone, a slow mount that refused grok read as if the folder had
  // been ruled out).
  it('a folder that did not open in time is named first', async () => {
    const cwd = tmpdir();
    const r = await runGrokCli('subscription', ['models'],
      { ...deps({ spawnError: true, code: -1, stderr: 'spawn grok EACCES' }), folderStarts: () => 'unanswered' }, { cwd });
    expect(r.message).toBe(`grok 실행에 실패했습니다: 작업 폴더가 5초 안에 열리지 않았습니다(EACCES) — ${cwd}. 폴더가 정상이면 설치/PATH를 확인하세요.`);
  });
  // The same through the default check — this Node started where the server is, changing into the folder — on a folder a non-root
  // user may list but not enter (0600): round 8 found three one-expression slips (the existence check in its place, a
  // check that always says yes, a check of the server's folder) that passed every injected test.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('the default check names a real folder no process can start in', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grok-cli-locked-'));
    try {
      chmodSync(dir, 0o600);
      const r = await runGrokCli('subscription', ['models'], deps({ spawnError: true, code: -1, stderr: 'spawn grok EACCES' }), { cwd: dir });
      expect(r.message).toBe(`grok 실행에 실패했습니다: 작업 폴더에서 프로세스를 시작할 수 없습니다(EACCES) — ${dir}`);
    } finally {
      chmodSync(dir, 0o700);
      rmSync(dir, { recursive: true, force: true });
    }
  });
  // Search permission, not read or write: 0600 can be listed but not entered, 0100 can only be entered (round 8: a
  // check of read or write permission passed a test that tried only 000). A missing folder does not start either, nor
  // does a file — one with its execute bit, which access(X_OK) passes. The capability, setuid and FUSE cases that
  // ruled out access(2) and a stat of `<dir>/.` (rounds 8 and 9) need privileges no test here has — they were
  // measured in containers.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('defaultFolderStarts: a child changes into the folder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grok-cli-enter-'));
    try {
      for (const [mode, starts] of [[0o755, true], [0o600, false], [0o100, true], [0o000, false]] as const) {
        chmodSync(dir, mode);
        expect(await defaultFolderStarts(dir), mode.toString(8)).toBe(starts);
      }
      chmodSync(dir, 0o700);
      writeFileSync(join(dir, 'a-file'), 'x');
      chmodSync(join(dir, 'a-file'), 0o755);
      expect(await defaultFolderStarts(join(dir, 'a-file')), 'an executable file').toBe(false);
      expect(await defaultFolderStarts(join(dir, 'missing')), 'a missing folder').toBe(false);
    } finally {
      chmodSync(dir, 0o700);
      rmSync(dir, { recursive: true, force: true });
    }
  });
  // A folder of 4,094 bytes: a child enters it, but a stat of `<dir>/.` is two bytes longer and fails with
  // ENAMETOOLONG — the round-8 check named this folder when a grok without its execute bit failed the start (round 9,
  // measured on glibc and musl). Linux: its PATH_MAX is 4,096 with the NUL.
  it.skipIf(process.platform !== 'linux')('a folder a child enters is not named, even where a stat of <dir>/. fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'grok-cli-long-'));
    try {
      let dir = root;
      while (4094 - dir.length > 201) { dir += '/' + 'a'.repeat(200); mkdirSync(dir); }
      dir += '/' + 'b'.repeat(4094 - dir.length - 1);
      mkdirSync(dir);
      expect(dir.length).toBe(4094);
      expect(await defaultFolderStarts(dir)).toBe(true);
      const r = await runGrokCli('subscription', ['models'], deps({ spawnError: true, code: -1, stderr: 'spawn grok EACCES' }), { cwd: dir });
      expect(r.message).toBe('grok 실행에 실패했습니다 (설치/PATH 확인).');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  // The check starts this Node (process.execPath). If that file is gone — an upgrade removed it while the server ran —
  // or has lost its execute bit, the check cannot start at all, and a fine folder was named while grok was simply
  // missing (round 9 follow-up, measured on Linux with the executable deleted; round 10: a version that cleared only
  // ENOENT named the folder for the execute bit). A check that cannot start says nothing about the folder.
  it.skipIf(process.platform === 'win32').each([
    ['gone', null],
    ['without its execute bit', 0o644],
  ] as const)('a check whose Node is %s does not name the folder', async (_label, mode) => {
    const dir = mkdtempSync(join(tmpdir(), 'grok-cli-node-'));
    const saved = process.execPath;
    process.execPath = join(dir, 'node');
    try {
      if (mode !== null) { writeFileSync(process.execPath, '#!/bin/sh\nexit 0\n'); chmodSync(process.execPath, mode); }
      expect(await defaultFolderStarts(tmpdir())).toBe(true);
      const r = await runGrokCli('subscription', ['models'], deps({ spawnError: true, code: -1, stderr: 'spawn grok ENOENT' }), { cwd: tmpdir() });
      expect(r.message).toBe('grok 실행에 실패했습니다 (설치/PATH 확인).');
    } finally {
      process.execPath = saved;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  // Round 10: the child changes into the folder itself. Started IN the folder, the start blocked this whole server for
  // as long as the kernel took to decide the chdir — Node's spawn() waits for the child to exec — so a slow FUSE mount
  // held every tool call 12 s, and 24 s where it also refused grok, and the 5 s cap never ran. It runs this Node, never
  // a `node` found on PATH or in the folder, with the folder as an argument — and with the server's environment, as a
  // subscription-mode grok gets it, without NODE_OPTIONS: emptied entirely, a Node that needs LD_LIBRARY_PATH to load
  // never started and a folder no one could enter read as the install (round 11).
  // Round 12: every API-key variable buildGrokEnv strips is gone (a version that deleted only XAI_API_KEY passed), and the
  // server's own environment is left as it was (one that deleted NODE_OPTIONS from process.env itself passed).
  // Round 13: the child starts where the server is — no chdir before its exec — not at `/`: `/proc/self/cwd` is then the
  // server's folder for the child as it was for grok's start, and a relative LD_LIBRARY_PATH resolves as it did when the
  // server started.
  it.skipIf(process.platform === 'win32')('the check runs this Node in the server\'s folder, the folder as its argument', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grok-cli-probe-'));
    const saved = process.execPath;
    const names = ['GROK_CLI_PROBE_MARK', 'NODE_OPTIONS', 'XAI_API_KEY', 'GROK_CODE_XAI_API_KEY', 'xai_api_key'] as const;
    const savedEnv = names.map((k) => process.env[k]);
    process.execPath = join(dir, 'node');
    try {
      process.env.GROK_CLI_PROBE_MARK = 'kept';
      process.env.NODE_OPTIONS = '--no-warnings';
      process.env.XAI_API_KEY = 'xai-probe-test';
      process.env.GROK_CODE_XAI_API_KEY = 'xai-probe-test-2';
      process.env.xai_api_key = 'xai-probe-test-3';
      writeFileSync(process.execPath, '#!/bin/sh\npwd -P > "$0.cwd"\nfor a in "$@"; do echo "$a"; done > "$0.args"\n'
        + 'echo "${GROK_CLI_PROBE_MARK:-}|${NODE_OPTIONS:-}|${XAI_API_KEY:-}|${GROK_CODE_XAI_API_KEY:-}|${xai_api_key:-}" > "$0.env"\n');
      chmodSync(process.execPath, 0o755);
      const folder = join(dir, 'work');
      mkdirSync(folder);
      expect(await defaultFolderStarts(folder)).toBe(true);
      expect(readFileSync(process.execPath + '.cwd', 'utf8').trim()).toBe(process.cwd());
      expect(readFileSync(process.execPath + '.args', 'utf8').trim().split('\n').at(-1)).toBe(folder);
      expect(readFileSync(process.execPath + '.env', 'utf8').trim()).toBe('kept||||');
      expect(process.env.NODE_OPTIONS).toBe('--no-warnings');
    } finally {
      process.execPath = saved;
      names.forEach((k, i) => { if (savedEnv[i] === undefined) delete process.env[k]; else process.env[k] = savedEnv[i]; });
      rmSync(dir, { recursive: true, force: true });
    }
  });
  // The folder is handed over as given and the server looks nothing up itself: the child starts where the server is, so
  // `/proc/self/cwd` — and `/dev/fd/..`, which the kernel follows to `/proc/self` — is the server's folder for it as it
  // was for grok's start. Round 11 rewrote `/proc/self` to the server's `/proc/<pid>`, which the child may not read (a
  // non-dumpable server, a PID namespace); round 12 skipped every path under `/proc` or `/dev/fd`, which gave up on a
  // folder no one could enter and blamed a fine one named through `/dev/fd/../cwd` (the child started at `/`); round 13's
  // first fix resolved the path in the server — realpath made `/proc/self` the server's `/proc/<pid>` again, and a lookup
  // answered late held the server's own threads (measured in containers; no test here can make a mount do that).
  // Round 14: `/proc/self/cwd/../fd/5` is a folder beside the server's, not a descriptor — `..` after `cwd` climbs
  // from the server's folder, which a version folding the path as text got wrong — and `/dev/fd/./../cwd` is the
  // server's folder (a version keeping `.` as a name read a descriptor there). Climbing to just below `/` and then
  // into `dev/fd/5` stays in a real folder (a version that took the server's folder for one unknown name climbed out).
  const cwdDepth = process.cwd().split('/').filter((s) => s !== '' && s !== '.').length;
  it.each(['/proc/self/cwd/sub', '/dev/fd/../cwd/sub', '/proc/1234/root/tmp', '/procedures/sub', '/dev/fd',
    '/proc/self/cwd/../fd/5', '/dev/fd/./../cwd/sub', '/proc/self/root/tmp', '/proc/self/cwd/dev/fd/5', '/proc/self/fd',
    '/proc/thread-self/fd', '/proc/self/cwd/' + '../'.repeat(Math.max(cwdDepth - 1, 0)) + 'dev/fd/5'])(
    'the check hands the folder over as given, started where the server is: %s', async (dir) => {
      const seen: Array<[string, unknown]> = [];
      const start = ((_file: string, args: string[], options: { cwd?: unknown }) => {
        seen.push([args.at(-1)!, options.cwd]);
        const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; kill: () => boolean; unref: () => void };
        child.stdout = new PassThrough();
        child.kill = () => true;
        child.unref = () => undefined;
        setTimeout(() => child.stdout.write('>EACCES;'), 10);
        return child;
      }) as unknown as typeof spawn;
      expect(await defaultFolderStarts(dir, 'linux', 300, start)).toBe(false);
      expect(seen).toEqual([[dir, undefined]]);
    });
  // A folder named through a descriptor — `/dev/fd/N`, `/proc/self/fd/N` — is the reader's own descriptor, and the child
  // holds none of the server's (grok's start still held them before its exec): not checked, the install pointed at as
  // in v0.2.35. No user can know the server's descriptor numbers. The path is followed as the kernel follows it through
  // the links every reader has — `/dev/fd` first, then `..` (round 14: `/dev/fd/../../self/fd/5` was checked, the child
  // reading its own descriptor), `/proc/self/root` as `/`, `/proc/self/cwd` as the server's folder. A link of the user's
  // own on the way is not followed.
  const upToRoot = '../'.repeat(cwdDepth);
  it.each(['/dev/fd/5', '/proc/self/fd/5', '/proc/thread-self/fd/5', '/dev/./fd/5', '/proc//self/fd/5', '/./dev/fd/5',
    '/proc/self/../self/fd/5', '/tmp/../dev/fd/5', '/dev/fd/../fd/5', '/dev/fd/5/sub', '/dev/fd/5/../..',
    '/dev/fd/../../self/fd/5', '/dev/fd/../../thread-self/fd/5', '/proc/self/root/dev/fd/5',
    '/proc/self/cwd/' + upToRoot + 'dev/fd/5'])(
    'a folder named through a descriptor is not checked: %s', async (dir) => {
      let started = 0;
      const start = (() => { started++; throw new Error('not expected'); }) as unknown as typeof spawn;
      expect(await defaultFolderStarts(dir, 'linux', 300, start)).toBe(true);
      expect(started).toBe(0);
    });
  // Linux, for real: this process's own folder through `/proc/self/cwd`, through `/dev/fd/..` and through a symlink to
  // `/proc/self/cwd`, and an open folder of this process through `/dev/fd` (not checked) — each the server's; and, as a
  // non-root user, a folder no one may enter (0600) named through each of the three is named, not cleared.
  it.skipIf(process.platform !== 'linux')('a folder named through this process\'s /proc/self is its own', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grok-cli-self-'));
    const fd = openSync(dir, 'r');
    try {
      symlinkSync('/proc/self/cwd', join(dir, 'here'));
      const sub = readdirSync(process.cwd(), { withFileTypes: true }).find((d) => d.isDirectory())!.name;
      for (const via of ['/proc/self/cwd/', '/dev/fd/../cwd/', join(dir, 'here') + '/']) {
        expect(await defaultFolderStarts(via + sub), via).toBe(true);
      }
      expect(await defaultFolderStarts('/dev/fd/' + fd)).toBe(true);
    } finally {
      closeSync(fd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it.skipIf(process.platform !== 'linux' || process.getuid?.() === 0)('a locked folder named through /proc/self/cwd is named', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grok-cli-selflock-'));
    const saved = process.cwd();
    try {
      mkdirSync(join(dir, 'locked'));
      chmodSync(join(dir, 'locked'), 0o600);
      symlinkSync('/proc/self/cwd', join(dir, 'here'));
      process.chdir(dir);
      for (const via of ['/proc/self/cwd/', '/dev/fd/../cwd/', join(dir, 'here') + '/']) {
        expect(await defaultFolderStarts(via + 'locked'), via).toBe(false);
      }
    } finally {
      process.chdir(saved);
      chmodSync(join(dir, 'locked'), 0o700);
      rmSync(dir, { recursive: true, force: true });
    }
  });
  // When the server's own loop stalls past the cap, the timer fires first on waking while the child's answer already
  // sits in the pipe; the cap is decided only after the pipe has been read (round 13: a refusing folder was pointed at
  // the install 58 to 80 times in 100 under a starved CPU, over rounds 13 and 14). Each window's cap: the loop is
  // blocked right after the call (the first cap fires with `>EACCES;` waiting, or with only `>` waiting — that opens the
  // second window, and a version whose first cap ignored the `>` pointed at the install), and after `>` was read (the
  // second cap fires with `EACCES;` waiting — a version that did not defer the second cap said "did not open"; round 14).
  // The stand-in waits for the stall to begin (`$0.go`) where the order matters: a `>` read before the stall opens the
  // second window early, and that window may rightly run out during the stall (the first draft of this test did).
  const stalled = async (script: string, capMs: number, before: number, stallMs: number): Promise<unknown> => {
    const dir = mkdtempSync(join(tmpdir(), 'grok-cli-stall-'));
    const saved = process.execPath;
    process.execPath = join(dir, 'node');
    try {
      writeFileSync(process.execPath, '#!/bin/sh\n' + script);
      chmodSync(process.execPath, 0o755);
      const answer = defaultFolderStarts(tmpdir(), 'linux', capMs);
      await new Promise((r) => setTimeout(r, before));
      await new Promise<void>((r) => setImmediate(() => {
        writeFileSync(process.execPath + '.go', '');
        const end = Date.now() + stallMs;
        while (Date.now() < end) { /* stall */ }
        r();
      }));
      return await answer;
    } finally {
      process.execPath = saved;
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const afterGo = 'while [ ! -f "$0.go" ]; do sleep 0.01; done\n';
  it.skipIf(process.platform === 'win32').each([
    ['the first cap, the answer waiting', "printf '>EACCES;'\n", 200, 0, 1_000],
    ['the first cap, only `>` waiting', afterGo + "printf '>'\nsleep 1.5\nprintf 'EACCES;'\nsleep 5\n", 1_000, 0, 1_300],
    ['the second cap, the answer waiting', "printf '>'\nsleep 0.5\nprintf 'EACCES;'\nsleep 5\n", 1_000, 300, 2_000],
  ] as const)('an answer already waiting wins over a cap that fired while the server was stalled: %s', async (_label, script, capMs, before, stallMs) => {
    expect(await stalled(script, capMs, before, stallMs)).toBe(false);
  }, 15_000);
  // The check is answered at its cap however its child behaves after the kill — a child stuck in the kernel on a hung
  // mount never exits, and a version that answered on the killed child's exit passed every test with a real one
  // (round 12). A stand-in child here never exits; it is killed, released (so it keeps neither the call nor the server
  // alive — round 12: the server waited 35 s to exit after its client left), and its pipe let go. Before it reaches the
  // chdir (no `>`), the cap says nothing about the folder: a Node slow to start is not a folder that did not open.
  // What the child writes decides, as soon as it is written — `>ok;` yes, `>EACCES;` no — and the child is let go
  // without waiting for it to exit (round 12: a Node writing coverage to a slow mount at exit turned a fine folder
  // into "did not open"). The stand-in never exits, so a version that answered on the exit would time out here.
  // Round 13: the two windows are two — `>` at 150 ms and `ok;` at 250 ms under a 200 ms cap is a folder that opened
  // (a version with one window from the start called it "did not open"); a child that ends after `>` without an answer
  // says yes; the second window is one cap long, measured from `>`.
  const fakeStart = (script: Array<[number, string]>, calls: string[]) => (() => {
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; kill: (s: string) => boolean; unref: () => void };
    child.stdout = new PassThrough();
    child.kill = (s) => { calls.push('kill ' + s); return true; };
    child.unref = () => { calls.push('unref'); };
    const destroy = child.stdout.destroy.bind(child.stdout);
    child.stdout.destroy = ((e?: Error) => { calls.push('destroy'); return destroy(e); }) as typeof child.stdout.destroy;
    for (const [at, what] of script) {
      setTimeout(() => { if (what === 'close') child.emit('close', 0, null); else { calls.push('wrote ' + what); child.stdout.write(what); } }, at);
    }
    return child;
  }) as unknown as typeof spawn;
  it.each([
    ['reached the chdir', [[10, '>']], 'unanswered', true],
    ['never reached the chdir', [], true, true],
    ['entered the folder', [[10, '>ok;']], true, true],
    ['was refused', [[10, '>EACCES;']], false, true],
    ['failed for a reason no folder gives', [[10, '>EMFILE;']], true, true],
    ['reached the chdir late and then entered', [[150, '>'], [250, 'ok;']], true, true],
    ['ended after `>` without an answer', [[10, '>'], [20, 'close']], true, false],
  ] as const)('a check whose child %s is answered without waiting for it to exit', async (_label, script, expected, killed) => {
    const calls: string[] = [];
    const t0 = performance.now();
    expect(await defaultFolderStarts('/tmp/folder', 'linux', 200, fakeStart(script as Array<[number, string]>, calls))).toBe(expected);
    expect(performance.now() - t0).toBeLessThan(2_000);
    expect(calls.filter((c) => !c.startsWith('wrote '))).toEqual(killed ? ['kill SIGKILL', 'unref', 'destroy'] : []);
  });
  it('the second window is one cap long, from `>`', async () => {
    const calls: string[] = [];
    let marked = 0;
    const start = fakeStart([[10, '>']], calls);
    const wrapped = ((...a: Parameters<typeof spawn>) => { const c = start(...a); setTimeout(() => { marked = performance.now(); }, 10); return c; }) as typeof spawn;
    expect(await defaultFolderStarts('/tmp/folder', 'linux', 300, wrapped)).toBe('unanswered');
    const waited = performance.now() - marked;
    expect(waited).toBeGreaterThanOrEqual(250);
    expect(waited).toBeLessThan(500);
  });
  // An answer leaves no timer behind (round 13: a version that did not clear it kept a process that ran one check
  // alive 5 s) — and a start that throws at once says nothing about the folder.
  it('an answered check leaves no timer running', async () => {
    const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    const before = timers();
    expect(await defaultFolderStarts('/tmp/folder', 'linux', 60_000, fakeStart([[5, '>EACCES;']], []))).toBe(false);
    await new Promise((r) => setImmediate(r));
    expect(timers()).toBe(before);
  });
  it('a start that throws at once does not name the folder', async () => {
    const start = (() => { throw Object.assign(new Error('spawn E2BIG'), { code: 'E2BIG' }); }) as unknown as typeof spawn;
    expect(await defaultFolderStarts('/tmp/folder', 'linux', 300, start)).toBe(true);
  });
  // …and the server's NODE_OPTIONS (a `--require` hook) does not run again in the check (round 10).
  it.skipIf(process.platform === 'win32')('the check does not run the server\'s NODE_OPTIONS', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grok-cli-env-'));
    const saved = process.env.NODE_OPTIONS;
    try {
      writeFileSync(join(dir, 'hook.cjs'), "require('fs').writeFileSync(__dirname + '/loaded', 'x');\n");
      process.env.NODE_OPTIONS = '--require ' + join(dir, 'hook.cjs');
      expect(await defaultFolderStarts(dir)).toBe(true);
      expect(existsSync(join(dir, 'loaded'))).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = saved;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  // …and with a real child: one that reached the chdir and does not answer is killed — with SIGKILL, which it cannot
  // ignore (a version sending SIGTERM left this one running, round 12) — and answers 'unanswered' AT the cap, the
  // server running meanwhile (round 10: a version with no cap waited 30 s, one that did not kill left the child
  // running; round 11: a spawnSync version froze the server for the whole wait, and one that answered on the pipe's
  // close waited for the grandchild holding it).
  it.skipIf(process.platform === 'win32')('a check that does not answer is killed and answered at its cap', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grok-cli-cap-'));
    const saved = process.execPath;
    process.execPath = join(dir, 'node');
    const pids: number[] = [];
    let ticks = 0;
    const tick = setInterval(() => { ticks++; }, 20);
    try {
      writeFileSync(process.execPath, "#!/bin/sh\nprintf '>'\ntrap '' TERM\nsleep 30 &\necho $! > \"$0.gpid\"\necho $$ > \"$0.pid\"\nexec sleep 30\n");
      chmodSync(process.execPath, 0o755);
      const t0 = performance.now();
      expect(await defaultFolderStarts(tmpdir(), 'linux', 300)).toBe('unanswered');
      expect(performance.now() - t0).toBeLessThan(3_000);
      expect(ticks).toBeGreaterThanOrEqual(3);
      pids.push(Number(readFileSync(process.execPath + '.pid', 'utf8')), Number(readFileSync(process.execPath + '.gpid', 'utf8')));
      let alive = true;
      for (let i = 0; i < 50 && alive; i++) {
        try { process.kill(pids[0], 0); await new Promise((r) => setTimeout(r, 20)); } catch { alive = false; }
      }
      expect(alive).toBe(false);
    } finally {
      clearInterval(tick);
      process.execPath = saved;
      for (const pid of pids) try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('on Windows a folder never stops a start, so the default check says yes there without one', async () => {
    expect(await defaultFolderStarts('C:\\no\\such\\folder', 'win32')).toBe(true);
  });
  // Round 3: on Windows a working folder of 259+ characters fails the start with ENOENT, and this said
  // "설치/PATH 확인" — the same misdirection the missing-folder check above was added to end.
  it.skipIf(process.platform !== 'win32')('a 259+ character working folder is named as the cause, not the install', async (ctx) => {
    let cwd = mkdtempSync(join(tmpdir(), 'grok-cli-longcwd-'));
    const base = cwd;
    while (cwd.length < 270) cwd = join(cwd, 'd'.repeat(30));
    try { mkdirSync(cwd, { recursive: true }); } catch { ctx.skip(); }
    try {
      const r = await runGrokCli('subscription', ['models'], deps({ spawnError: true, code: -1, stderr: 'spawn grok ENOENT' }), { cwd });
      expect(r.status).toBe('error');
      expect(r.message).toContain(`${cwd.length}자`);
      expect(r.message).not.toContain('PATH');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

// ── Audit 2, 2026-09-03. `stdoutTail` silently kept the last 4000 chars with no marker and no
// total, so a caller could not tell a fragment from grok's whole output. Measured: `grok inspect
// --json` is ~81 KB on an ordinary machine, so commands/inspect.md's instruction to "present the
// parsed config from stdoutTail" was unsatisfiable — the tail is 4.9% of the document and does
// not parse. Truncation stays (it is a documented token budget); it is now declared.
describe('runGrokCli truncation reporting', () => {
  const bigSpawn = (n: number): SpawnFn =>
    async () => ({ code: 0, stdout: 'x'.repeat(n), stderr: '', timedOut: false });

  it('declares truncation and the original size when stdout exceeds the cap', async () => {
    const r = await runGrokCli('subscription', ['inspect'], { spawn: bigSpawn(81_000), env: {} });
    expect(r.status).toBe('ok');
    expect(r.stdoutTruncated).toBe(true);
    expect(r.stdoutTotalChars).toBe(81_000);
    expect(r.stdoutTail!.length).toBe(4000);
  });

  it('says nothing when the output fits', async () => {
    const r = await runGrokCli('subscription', ['models'], { spawn: bigSpawn(120), env: {} });
    expect(r.stdoutTruncated).toBeUndefined();
    expect(r.stdoutTotalChars).toBeUndefined();
    expect(r.stdoutTail).toHaveLength(120);
  });

  it('declares it on the timeout path too', async () => {
    const r = await runGrokCli('subscription', ['inspect'], {
      spawn: async () => ({ code: null, stdout: 'y'.repeat(9000), stderr: '', timedOut: true }),
      env: {},
    }, { timeoutMs: 1000 });
    expect(r.status).toBe('timeout');
    expect(r.stdoutTruncated).toBe(true);
    expect(r.stdoutTotalChars).toBe(9000);
  });
});

// A missing cwd produced `spawn grok ENOENT`, reported as "grok 실행에 실패했습니다 (설치/PATH
// 확인)" — telling the user to check their grok install when the real fault is the path they
// passed. runDelegate already guards this with dirExists; grok_cli did not.
describe('runGrokCli cwd validation', () => {
  it('rejects a cwd that does not exist, without spawning', async () => {
    let spawned = false;
    const r = await runGrokCli('subscription', ['models'], {
      spawn: async () => { spawned = true; return { code: 0, stdout: '', stderr: '', timedOut: false }; },
      env: {},
    }, { cwd: join(tmpdir(), 'grok-does-not-exist-zzz9') });
    expect(r.status).toBe('error');
    expect(spawned).toBe(false);
    expect(r.message).toMatch(/디렉토리/);
  });
});

// A2 (docs/10, MEASURED 2026-09-05 against the shipped 0.2.19 bundle): a passthrough
//   grok_cli {"args":["-p","Create a file named a2.txt …","--always-approve"],"cwd":<throwaway>}
// returned status ok, actually wrote a2.txt, and burned a subscription turn — while
// ~/.grok-build/history.jsonl went from 1790 lines to 1790. /grok:usage and /grok:status read that
// file, so every passthrough edit was invisible to the very dashboards that report usage.
// Recording it needs two things the passthrough never computed: whether the run carried a prompt
// at all, and which files it touched.
describe('A2 — a passthrough that carries a prompt is a delegation', () => {
  it('recognises every flag that makes grok run a turn', () => {
    expect(extractPromptRun(['-p', 'do the thing'])?.prompt).toBe('do the thing');
    expect(extractPromptRun(['--single=do the thing'])?.prompt).toBe('do the thing');
    expect(extractPromptRun(['--single', 'do the thing'])?.prompt).toBe('do the thing');
    expect(extractPromptRun(['-p', 'x', '--always-approve'])?.prompt).toBe('x');
  });

  it('records a prompt-file run without inventing a prompt it never read', () => {
    // The file's CONTENT is the prompt and we do not open it — say what we know, not more.
    expect(extractPromptRun(['--prompt-file', 'task.md'])?.prompt).toBe('(--prompt-file task.md)');
  });

  it('does not treat a read-only subcommand as a turn', () => {
    for (const args of [['sessions', 'list'], ['models'], ['--version'], ['inspect', '--json'], ['memory', 'list']]) {
      expect(extractPromptRun(args), args.join(' ')).toBeUndefined();
    }
  });

  // FOUND BY GROK reviewing the first version of this parser, then MEASURED on grok 1.0.13:
  //   `grok -vp`  -> exit 2, "a value is required for '--single <PROMPT>'"   (clap read -v -p)
  //   `grok -sp`  -> "--session-id must be a valid UUID (got 'p')"           (clap read -s p)
  // Clustering is real, so `["-vp","x"]` spends a turn while whole-token matching saw nothing.
  it('sees a prompt through a clustered short flag', () => {
    expect(extractPromptRun(['-vp', 'x'])?.prompt).toBe('x');
    expect(extractPromptRun(['-vpHello'])?.prompt).toBe('Hello');
    expect(extractPromptRun(['-px'])?.prompt).toBe('x');
  });

  // A28, MEASURED 2026-09-22 end-to-end through the SHIPPED v0.2.25 bundle on grok 1.0.30:
  //   history rows before: 848
  //   grok_cli {"args":["-cp","Say ok and stop."]} -> status ok, exit 0, stdout "ok"
  //   history rows after:  848      (delta 0 — a real subscription turn, recorded nowhere)
  // clap reads `-cp X` as `-c -p X` = --continue + --single X. `-c, --continue` is a BOOLEAN
  // short, so the cluster is fully resolvable and the prompt IS nameable — this is not the
  // `-mp x` case the recorder deliberately declines.
  //
  // The AUTH GATE was never part of this defect. Re-measured the same day against the shipped
  // dist/hook.js with an empty GROK_HOME: `["-cp","x"]` -> permissionDecision "deny", exactly
  // like `["-p","x"]`, because mayRunTurn's second path never consults BOOLEAN_SHORTS. Only the
  // recorder was blind, so only provenance was lost.
  it('records a turn clustered behind --continue (A28)', () => {
    expect(extractPromptRun(['-cp', 'fix it'])?.prompt).toBe('fix it');
    expect(extractPromptRun(['-cvp', 'fix it'])?.prompt).toBe('fix it');
    expect(extractPromptRun(['-cpHello'])?.prompt).toBe('Hello');
    // The gate already covered these; assert it so a future change cannot quietly narrow it.
    expect(mayRunTurn(['-cp', 'fix it'])).toBe(true);
  });

  it('does not guess a prompt out of a cluster it cannot resolve', () => {
    // `-m` takes a value, so `-mp x` is --model p with no prompt at all. Naming `x` as the
    // prompt would write a fiction into the delegation history.
    expect(extractPromptRun(['-mp', 'x'])).toBeUndefined();
  });

  it('the auth gate is wider than the recorder, on purpose', () => {
    // Ambiguous cluster: not recorded (we cannot name it) but gated (it might spend a turn).
    expect(mayRunTurn(['-mp', 'x'])).toBe(true);
    expect(mayRunTurn(['-vp', 'x'])).toBe(true);
    expect(mayRunTurn(['sessions', 'list'])).toBe(false);
    expect(mayRunTurn(['--version'])).toBe(false);
    expect(mayRunTurn(['-wq', 'name'])).toBe(false);
  });
  it('a dangling prompt flag with no value is not a turn', () => {
    // `grok sessions search -p` — the flag is the last token, so there is no prompt to run.
    expect(extractPromptRun(['sessions', 'search', '-p'])).toBeUndefined();
    expect(extractPromptRun(['-p'])).toBeUndefined();
  });

  // KNOWN LIMIT, deliberately left: `['sessions','search','-p','foo']` is read as a prompt run,
  // because `-p` is a GLOBAL grok flag and this parse cannot tell a global flag from a
  // subcommand's own argument that happens to be spelled `-p`. It errs toward recording, which
  // costs a spurious history row; the opposite error costs an unrecorded turn, which is the bug
  // this whole item exists to fix. Verified against `grok --help` on 1.0.13: -p/--single,
  // --prompt-file and --prompt-json are the complete set of single-turn prompt flags.
  it('errs toward recording when a subcommand argument is spelled like a prompt flag', () => {
    expect(extractPromptRun(['sessions', 'search', '-p', 'foo'])?.prompt).toBe('foo');
  });
  it('reports filesChanged for a prompt run, like delegate does', async () => {
    const seen: string[] = [];
    const r = await runGrokCli('subscription', ['-p', 'write a file', '--always-approve'], {
      spawn: async () => ({ stdout: 'done', stderr: '', code: 0 }),
      env: {},
      gitChangedFiles: async () => (seen.push('call'), seen.length === 1 ? [] : ['a2.txt']),
    } as never, { cwd: tmpdir() });
    expect(r.status).toBe('ok');
    expect(r.promptRun).toBe(true);
    expect(r.filesChanged).toEqual(['a2.txt']);
  });

  it('does not run git for a read-only subcommand', async () => {
    let git = 0;
    const r = await runGrokCli('subscription', ['sessions', 'list'], {
      spawn: async () => ({ stdout: 'x', stderr: '', code: 0 }),
      env: {},
      gitChangedFiles: async () => (git++, []),
    } as never, { cwd: tmpdir() });
    expect(git).toBe(0);
    expect(r.promptRun).toBeUndefined();
    expect(r.filesChanged).toBeUndefined();
  });
});

describe('runGrokCli cancelled confirmation (A9)', () => {
  // MEASURED 2026-09-06 through the shipped bundle, `grok memory clear --global` with no stdin:
  //   { status: "ok", exitCode: 0, stdoutTail: "...Are you sure? [y/N] Cancelled.\n" }, isError false.
  // A destructive command that deleted nothing, reported as success. The only evidence was a
  // string inside stdoutTail — and stdoutTail is the LAST 4000 characters, so a long confirmation
  // list pushes that evidence out of the response entirely.
  const CANCEL_STDOUT = [
    'The following will be deleted:',
    '  global MEMORY.md: C:/tmp/h/memory/MEMORY.md',
    '',
    'Are you sure? [y/N] Cancelled.',
    '',
  ].join('\n');

  it('flags a cancelled confirmation instead of calling it plain ok', async () => {
    const r = await runGrokCli('subscription', ['memory', 'clear', '--global'], deps({ code: 0, stdout: CANCEL_STDOUT }));
    expect(r.status).toBe('ok'); // the process really did exit 0 — that part was never wrong
    expect(r.exitCode).toBe(0);
    expect(r.cancelled).toBe(true);
    expect(r.message).toBeDefined();
  });

  // The whole point of a structured field: detection runs on the WHOLE stdout, before the cut.
  it('still flags it when the marker sits past the 4000-char tail', async () => {
    const filler = 'x'.repeat(6000);
    const r = await runGrokCli(
      'subscription',
      ['memory', 'clear', '--global'],
      deps({ code: 0, stdout: CANCEL_STDOUT + filler }),
    );
    expect(r.stdoutTruncated).toBe(true);
    expect(r.stdoutTail).not.toContain('Cancelled');
    expect(r.cancelled).toBe(true);
  });

  it('does not flag an ordinary successful run', async () => {
    const r = await runGrokCli('subscription', ['models'], deps({ code: 0, stdout: 'grok-4.5\ngrok-code\n' }));
    expect(r.cancelled).toBeUndefined();
  });

  // A prompt that was ANSWERED (or auto-confirmed with -y) is not a cancellation, and neither is
  // prose that merely contains the word — `sessions search cancelled` is a legitimate query.
  it('does not flag a confirmed prompt, nor the bare word in output', async () => {
    const confirmed = await runGrokCli(
      'subscription',
      ['memory', 'clear', '--global', '-y'],
      deps({ code: 0, stdout: 'Are you sure? [y/N] y\nCleared global MEMORY.md.\n' }),
    );
    expect(confirmed.cancelled).toBeUndefined();

    const prose = await runGrokCli(
      'subscription',
      ['sessions', 'search', 'cancelled'],
      deps({ code: 0, stdout: 'session 1: the user cancelled the deploy\n' }),
    );
    expect(prose.cancelled).toBeUndefined();
  });

  // A cancel is not a failure of the tool, so it must not be laundered into one either — a
  // non-zero exit stays an error and keeps its own reporting.
  it('leaves a genuine error alone', async () => {
    const r = await runGrokCli('subscription', ['sessions', 'delete', 'nope'], deps({ code: 1, stdout: '', stderr: 'no such session\n' }));
    expect(r.status).toBe('error');
    expect(r.cancelled).toBeUndefined();
  });
});

describe('unknown first positional is refused without spawning (A11)', () => {
  // MEASURED 2026-09-06 through the shipped bundle:
  //   grok_cli {"args":["sesions"]}          -> status timeout, 20s burned (60s by default),
  //                                             stderrTail = unreadable ANSI TUI frames
  //   grok_cli {"args":["sesions","list"]}   -> status error, exit 2, 793ms, a real message
  // grok's usage is `grok [OPTIONS] [PROMPT] [COMMAND]`, so a lone unknown token is taken as a
  // PROMPT and opens the interactive UI — the same mechanism `import` was already blocked for.

  it('refuses a one-word typo instead of burning the timeout', () => {
    expect(unknownGrokSubcommand(['sesions'])).toBe('sesions');
    expect(unknownGrokSubcommand(['sesssions'])).toBe('sesssions');
  });

  it('lets every subcommand grok 1.0.13 lists through', () => {
    for (const sub of [
      'agent', 'clone', 'completions', 'dashboard', 'doctor', 'du', 'export', 'help', 'inspect',
      'leader', 'login', 'logout', 'mcp', 'memory', 'models', 'plugin', 'sessions', 'setup',
      'trace', 'update', 'version', 'worktree', 'wrap',
    ]) {
      expect(unknownGrokSubcommand([sub])).toBeUndefined();
    }
  });

  it('accepts the aliases grok documents beside them', () => {
    expect(unknownGrokSubcommand(['disk-usage'])).toBeUndefined(); // du
    expect(unknownGrokSubcommand(['v'])).toBeUndefined();          // version
  });

  // A30, MEASURED 2026-09-22 on grok 1.0.30 (`grok usage --help`, and through the shipped bundle):
  //   grok_cli {"args":["usage","<id>"]} -> status blocked, "이 래퍼가 아는 1.0 서브커맨드가 아닙니다"
  // `grok usage <SESSION_ID> [TURN]` prints persisted tokens AND cost per session and per turn —
  // the only CLI surface that carries them — and the wrapper already stores that session id on
  // every delegation row (history.ts `sessionId`). Refusing it kept the two halves apart.
  // It spends nothing: it reads ~/.grok, makes no model call.
  it('lets `usage` through — the read-only token/cost readout (A30)', () => {
    expect(unknownGrokSubcommand(['usage'])).toBeUndefined();
    expect(unknownGrokSubcommand(['usage', '01a0c902-d997-7933-9e02-beccf9f12cff'])).toBeUndefined();
  });

  it('only judges the FIRST positional — the rest belong to the subcommand', () => {
    expect(unknownGrokSubcommand(['sessions', 'search', 'sesions'])).toBeUndefined();
    expect(unknownGrokSubcommand(['memory', 'clear', '--global'])).toBeUndefined();
  });

  it('does not fire when there is no positional at all', () => {
    expect(unknownGrokSubcommand([])).toBeUndefined();
    expect(unknownGrokSubcommand(['--help'])).toBeUndefined();
    expect(unknownGrokSubcommand(['--version'])).toBeUndefined();
  });

  it('does not fire on a prompt run — the prompt is a flag value, not a subcommand', () => {
    expect(unknownGrokSubcommand(['-p', 'sesions'])).toBeUndefined();
    expect(unknownGrokSubcommand(['-p', 'refactor the parser'])).toBeUndefined();
    expect(unknownGrokSubcommand(['--single', 'anything at all'])).toBeUndefined();
  });

  // Staleness runs the OPPOSITE way from the denylist: that one over-blocks when it goes stale,
  // this one would refuse a subcommand grok added after the snapshot. So when the parse cannot
  // identify the subcommand slot, this rule stands down — the token may be an unrecognised
  // flag's value, and false-blocking a working command is worse than one slow failure.
  it('stands down when an unrecognised flag makes the subcommand slot uncertain', () => {
    expect(unknownGrokSubcommand(['--brand-new-flag', 'itsvalue'])).toBeUndefined();
  });

  it('blocks without spawning, and names the token', async () => {
    let spawned = false;
    const r = await runGrokCli('subscription', ['sesions'], {
      spawn: async () => { spawned = true; return { code: 0, stdout: '', stderr: '', timedOut: false }; },
      env: {},
    });
    expect(spawned).toBe(false);
    expect(r.status).toBe('blocked');
    expect(r.message).toContain('sesions');
  });

  it('still spawns a legitimate subcommand', async () => {
    let spawned = false;
    const r = await runGrokCli('subscription', ['sessions', 'list'], {
      spawn: async () => { spawned = true; return { code: 0, stdout: 'ok', stderr: '', timedOut: false }; },
      env: {},
    });
    expect(spawned).toBe(true);
    expect(r.status).toBe('ok');
  });

  // The denylist still wins where both apply, so the message keeps naming the real reason.
  it('a denylisted subcommand keeps its own message', async () => {
    const r = await runGrokCli('subscription', ['dashboard'], {
      spawn: async () => ({ code: 0, stdout: '', stderr: '', timedOut: false }),
      env: {},
    });
    expect(r.status).toBe('blocked');
    expect(r.message).toContain('헤드리스');
  });
});

describe('output whose meaning is at the top keeps the top (A15)', () => {
  // MEASURED 2026-09-06 through the shipped bundle:
  //   grok_cli {"args":["inspect"]} -> 7269 chars, we kept the LAST 4000, and the slice began
  //   mid-line inside a plugin command list. Everything inspect exists to tell you — grok home,
  //   model, auth, where each setting came from — is printed first and was exactly what got cut.
  //   `grok --help` behaves the same way; this session lost its head to the same rule.
  const long = (n: number) => 'H'.repeat(n);

  it('keeps the head for inspect', async () => {
    const stdout = 'GROK HOME: /home/x' + long(6000) + 'TAILEND';
    const r = await runGrokCli('subscription', ['inspect'], deps({ code: 0, stdout }));
    expect(r.stdoutTruncated).toBe(true);
    expect(r.stdoutKept).toBe('head');
    expect(r.stdoutTail!.startsWith('GROK HOME: /home/x')).toBe(true);
    expect(r.stdoutTail).not.toContain('TAILEND');
  });

  it('keeps the head for help, in both its forms', async () => {
    const stdout = 'Usage: grok [OPTIONS]' + long(6000) + 'TAILEND';
    for (const args of [['help'], ['--help'], ['-h'], ['sessions', '--help']]) {
      const r = await runGrokCli('subscription', args, deps({ code: 0, stdout }));
      expect(r.stdoutKept, args.join(' ')).toBe('head');
      expect(r.stdoutTail!.startsWith('Usage: grok [OPTIONS]'), args.join(' ')).toBe(true);
    }
  });

  it('still keeps the tail everywhere else — a command log ends with its outcome', async () => {
    const stdout = 'HEADSTART' + long(6000) + 'the answer is 42';
    const r = await runGrokCli('subscription', ['sessions', 'list'], deps({ code: 0, stdout }));
    expect(r.stdoutKept).toBe('tail');
    expect(r.stdoutTail!.endsWith('the answer is 42')).toBe(true);
  });

  it('says nothing about which end was kept when nothing was cut', async () => {
    const r = await runGrokCli('subscription', ['inspect'], deps({ code: 0, stdout: 'short' }));
    expect(r.stdoutTruncated).toBeUndefined();
    expect(r.stdoutKept).toBeUndefined();
    expect(r.stdoutTail).toBe('short');
  });

  // The other half of A15: `inspect --json` measured ~81 KB, of which any 4000-char slice is
  // unparseable. A caller that genuinely needs the document can ask for it, explicitly, and
  // wear the token cost — the default stays small.
  it('honours an explicit larger cap', async () => {
    const stdout = long(20000);
    const r = await runGrokCli('subscription', ['inspect', '--json'], deps({ code: 0, stdout }), { maxChars: 50000 });
    expect(r.stdoutTruncated).toBeUndefined();
    expect(r.stdoutTail!.length).toBe(20000);
  });

  it('clamps a cap that is absurd or nonsense rather than trusting it', async () => {
    const stdout = long(20000);
    const huge = await runGrokCli('subscription', ['inspect'], deps({ code: 0, stdout }), { maxChars: 99_999_999 });
    expect(huge.stdoutTail!.length).toBeLessThanOrEqual(MAX_STDOUT_CHARS);
    const zero = await runGrokCli('subscription', ['inspect'], deps({ code: 0, stdout }), { maxChars: 0 });
    expect(zero.stdoutTail!.length).toBe(STDOUT_TAIL_CHARS);
    const nan = await runGrokCli('subscription', ['inspect'], deps({ code: 0, stdout }), { maxChars: Number.NaN });
    expect(nan.stdoutTail!.length).toBe(STDOUT_TAIL_CHARS);
  });
});

// A24 (docs/10, MEASURED 2026-09-06 through the SHIPPED bundle and the SHIPPED dist/hook.js).
//
// `-p` takes its value attached as well as separated — clap reads `-p2+2` exactly as `-p 2+2`.
// MEASURED, both forms sent through grok_cli with a deliberately bogus --model: grok answered
// with the SAME error ("unknown model id") for each, so it accepted the attached token as the
// flag rather than complaining about an unexpected argument.
//
// The old cluster shape was /^-[A-Za-z][A-Za-z]+$/ — the WHOLE token had to be letters, which is
// only true when the attached value happens to be alphabetic. So an attached value carrying a
// digit, a slash or a dot was invisible to both functions at once. Measured consequences:
//   dist/hook.js, logged out:  ["-p","2+2"] -> deny        ["-p2+2"] -> ALLOW (no auth gate)
//   shipped bundle, signed in: ["-p2+2","--output-format","json"] -> status ok, grok returned
//                              text "**4**", stopReason end_turn, a real sessionId+requestId —
//                              a paid turn — while promptRun was absent and the history file
//                              stayed at 2 rows.
// grok_cli has no server-side checkAuth (hook.ts says so itself), so the hook is the ONLY gate a
// passthrough gets, and that gate was open. This is A2's harm through a different door.
describe('A24 — an attached prompt value is still a prompt', () => {
  it('records the prompt when the attached value is not alphabetic', () => {
    expect(extractPromptRun(['-p2+2'])?.prompt).toBe('2+2');
    expect(extractPromptRun(['-p/tmp/x'])?.prompt).toBe('/tmp/x');
    expect(extractPromptRun(['-pfoo.txt'])?.prompt).toBe('foo.txt');
    expect(extractPromptRun(['-vp2+2'])?.prompt).toBe('2+2');
    // clap accepts `-p=VALUE` too, and this branch now sees that token first.
    expect(extractPromptRun(['-p=2+2'])?.prompt).toBe('2+2');
  });

  it('gates the auth check on the same tokens', () => {
    expect(mayRunTurn(['-p2+2'])).toBe(true);
    expect(mayRunTurn(['-p/tmp/x'])).toBe(true);
    expect(mayRunTurn(['-pfoo.txt'])).toBe(true);
  });

  it('still refuses to invent a prompt, and still lets read-only queries through', () => {
    // Regressions the A2/Grok round bought: `-m` takes a value, so `-mp x` is --model p.
    expect(extractPromptRun(['-mp', 'x'])).toBeUndefined();
    expect(mayRunTurn(['-mp', 'x'])).toBe(true);       // ambiguous → gated, not recorded
    expect(extractPromptRun(['-p'])).toBeUndefined();  // dangling flag, no value, no turn
    expect(mayRunTurn(['sessions', 'list'])).toBe(false);
    expect(mayRunTurn(['--version'])).toBe(false);
    expect(mayRunTurn(['-wq', 'name'])).toBe(false);
    // A value attached to a NON-prompt short flag must not be read as a prompt just because
    // some character in it happens to be `p`.
    expect(mayRunTurn(['-s01a0p619-d939-7d91'])).toBe(false);
  });
});

// A25 (docs/10, MEASURED 2026-09-06 through the shipped bundle): runGrokCli defaults the working
// directory to process.cwd(), but did not report which directory it used, so its caller had to
// guess — and guessed `''`. The result now carries it.
describe('A25 — runGrokCli reports the directory it used', () => {
  it('reports the resolved cwd even when the caller passed none', async () => {
    const r = await runGrokCli('subscription', ['sessions', 'list'], deps({ code: 0, stdout: 'ok' }));
    expect(r.cwd).toBe(process.cwd());
  });

  it('reports the caller cwd when one was passed', async () => {
    const r = await runGrokCli('subscription', ['sessions', 'list'], deps({ code: 0, stdout: 'ok' }), { cwd: process.cwd() });
    expect(r.cwd).toBe(process.cwd());
  });
});
