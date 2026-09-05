import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGrokCli, isBlockedGrokCommand, extractPromptRun, type GrokCliDeps } from '../src/grok-cli.js';
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

  it('reports filesChanged for a prompt run, like delegate does', async () => {
    const seen: string[] = [];
    const r = await runGrokCli('subscription', ['-p', 'write a file', '--always-approve'], {
      spawn: async () => ({ stdout: 'done', stderr: '', code: 0 }),
      env: {},
      gitChangedFiles: async () => (seen.push('call'), seen.length === 1 ? [] : ['a2.txt']),
    } as never, { cwd: '/tmp' });
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
    } as never, { cwd: '/tmp' });
    expect(git).toBe(0);
    expect(r.promptRun).toBeUndefined();
    expect(r.filesChanged).toBeUndefined();
  });
});
