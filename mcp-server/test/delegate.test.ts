import { describe, it, expect, vi, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, renameSync, statSync, existsSync, symlinkSync, utimesSync,
  appendFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
import {
  runDelegate, parsePorcelain, diffChangedFiles, validateDelegateOptions, defaultGitChangedFiles,
  appendBounded, STDOUT_CAP_BYTES, STDERR_CAP_BYTES, spawnBounded, defaultGitDirtyFingerprint, readExactly, longCwdHint, spawnErrorCode,
  ARGV_PROMPT_LIMIT_WIN32_UNITS, ARGV_PROMPT_LIMIT_POSIX_BYTES, promptFitsArgv,
  looksLikeAuthFailure, isTimedOutDeviceAuth, resolveSessionCwd, defaultSessionsIndex, sameDirectory, shellDir,
  NO_COMMIT_PROMPT_SUFFIX, OFFLOAD_MIN_BYTES, offloadNote, keptByGrok, writtenByTime,
  type SpawnFn, type SpawnResult, type DelegateDeps,
} from '../src/delegate.js';
import type { DelegateInput } from '../src/types.js';

const okJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ text: 'done', stopReason: 'EndTurn', ...over });
const fakeSpawn = (r: Partial<SpawnResult>): SpawnFn =>
  async () => ({ code: 0, stdout: '', stderr: '', timedOut: false, ...r });
/** before=clean, after=`files` — matches production before/after snapshot. */
const deps = (spawnR: Partial<SpawnResult>, files: string[] = []): DelegateDeps => {
  let calls = 0;
  return {
    spawn: fakeSpawn(spawnR),
    gitChangedFiles: () => {
      calls += 1;
      return calls === 1 ? [] : files;
    },
    dirExists: () => true,
  };
};
const input = { prompt: 'do x', cwd: '/tmp/proj' };

describe('runDelegate', () => {
  it('EndTurn maps to completed with text summary, git-derived files, billing by mode', async () => {
    const r = await runDelegate('api', input, deps({ stdout: okJson({ text: 'made hi.txt' }) }, ['hi.txt']));
    expect(r.status).toBe('completed');
    expect(r.mode).toBe('api');
    expect(r.billing).toBe('metered_api');
    expect(r.summary).toContain('made hi.txt');
    expect(r.filesChanged).toEqual(['hi.txt']);
  });
  it('1.0 snake_case end_turn maps to completed (measured grok 1.0.3)', async () => {
    const r = await runDelegate(
      'subscription',
      input,
      deps({ stdout: okJson({ stopReason: 'end_turn', text: 'made hi.txt', sessionId: 's1' }) }, ['hi.txt']),
    );
    expect(r.status).toBe('completed');
    expect(r.summary).toContain('made hi.txt');
    expect(r.filesChanged).toEqual(['hi.txt']);
    expect(r.sessionId).toBe('s1');
  });
  it('snake_case cancelled still maps to grok_error', async () => {
    const r = await runDelegate('subscription', input, deps({ stdout: okJson({ stopReason: 'cancelled' }) }));
    expect(r.status).toBe('grok_error');
    expect(r.message).toContain('cancelled');
  });
  it('subscription mode reports subscription billing', async () => {
    const r = await runDelegate('subscription', input, deps({ stdout: okJson() }));
    expect(r.billing).toBe('subscription');
  });
  it('non-EndTurn stopReason maps to grok_error even though exit code is 0', async () => {
    const r = await runDelegate('subscription', input, deps({ code: 0, stdout: okJson({ stopReason: 'Cancelled' }) }));
    expect(r.status).toBe('grok_error');
    expect(r.message).toContain('Cancelled');
  });
  it('timeout maps to status timeout', async () => {
    const r = await runDelegate('subscription', input, deps({ timedOut: true, code: null }));
    expect(r.status).toBe('timeout');
  });
  // Measured (docs/specs/grok-cli-contract.md §7): on a missing/expired session, headless grok
  // does not print "not authenticated" — it starts a device-OAuth flow and BLOCKS ("Waiting for
  // authorization..."), so the wrapper times out. Detect that so the user is told to `grok login`.
  it('timeout WITH a device-OAuth-flow signal in stderr maps to auth_error (subscription)', async () => {
    const stderr = 'To sign in, open this URL in your browser:\n  https://accounts.x.ai/oauth2/device?user_code=QF8J-TNDD\nWaiting for authorization...';
    const r = await runDelegate('subscription', input, deps({ timedOut: true, code: null, stderr }));
    expect(r.status).toBe('auth_error');
    expect(r.message).toContain('grok login');
  });
  it('timeout WITH a device-OAuth-flow signal in stderr maps to auth_error (api → key hint)', async () => {
    const stderr = 'Waiting for authorization... https://accounts.x.ai/oauth2/device?user_code=ABCD';
    const r = await runDelegate('api', input, deps({ timedOut: true, code: null, stderr }));
    expect(r.status).toBe('auth_error');
    expect(r.message).toContain('XAI_API_KEY');
  });
  it('plain timeout (no auth signal) stays status timeout', async () => {
    const r = await runDelegate('subscription', input, deps({ timedOut: true, code: null, stderr: 'still building the project...' }));
    expect(r.status).toBe('timeout');
  });
  // P1 reliability: timeout must NOT treat ordinary "grok login" text in stdout as auth_error
  it('timeout with "grok login" only in stdout stays timeout (no device-flow stderr)', async () => {
    const r = await runDelegate('subscription', input, deps({
      timedOut: true,
      code: null,
      stdout: 'thought: user should run grok login later when they want to auth',
      stderr: 'still compiling…',
    }));
    expect(r.status).toBe('timeout');
  });
  // Successful JSON text can mention `grok login` (docs, comments, plans). Scanning
  // parsed.text for AUTH_ERROR_SIGNALS before stopReason mislabels those as auth_error.
  it('end_turn whose summary mentions grok login stays completed', async () => {
    const r = await runDelegate(
      'subscription',
      input,
      deps({
        stdout: okJson({
          stopReason: 'end_turn',
          text: 'Updated README: tell the user to run grok login once.',
        }),
      }, ['README.md']),
    );
    expect(r.status).toBe('completed');
    expect(r.summary).toMatch(/grok login/);
    expect(r.filesChanged).toEqual(['README.md']);
  });
  it('plan text that mentions grok login stays completed', async () => {
    const r = await runDelegate(
      'subscription',
      { prompt: 'plan auth docs', cwd: '/tmp/proj', plan: true },
      deps({
        stdout: okJson({
          stopReason: 'end_turn',
          text: 'Step 1: if unauthenticated, the human runs grok login in a terminal.',
        }),
      }),
    );
    expect(r.status).toBe('completed');
    expect(r.summary).toMatch(/grok login/);
    expect(r.filesChanged).toEqual([]);
  });
  it('non-JSON stdout with an auth signal maps to auth_error', async () => {
    const r = await runDelegate('subscription', input, deps({ stdout: '', stderr: 'Error: not authenticated' }));
    expect(r.status).toBe('auth_error');
  });
  it('non-JSON stdout without an auth signal maps to grok_error', async () => {
    const r = await runDelegate('subscription', input, deps({ stdout: 'boom', stderr: 'compile failed' }));
    expect(r.status).toBe('grok_error');
  });
  // MEASURED 2026-07-25: isolated USERPROFILE → immediate JSON error (no device-flow block).
  it('JSON type:error Not signed in maps to auth_error (modern unauth path)', async () => {
    const stdout = JSON.stringify({
      type: 'error',
      message: 'Not signed in. To authenticate without a browser, run:\n  grok login --device-code\n\nAlternatively, set the XAI_API_KEY environment variable or run `grok login` on a machine with a browser.',
    });
    const stderr = 'Error: Not signed in. To authenticate without a browser, run:\n  grok login --device-code';
    const r = await runDelegate('subscription', input, deps({ code: 1, stdout, stderr }));
    expect(r.status).toBe('auth_error');
    expect(r.message).toMatch(/grok login/);
  });
  // MEASURED 2026-09-05 (1.0.13, contract §7 path C): a REJECTED session (auth.json present,
  // token expired or revoked) exits 1 with a 401 envelope that never says "not signed in" —
  // and whose trailer says the opposite ("no need to run /login"). Before the
  // "invalid or expired credentials" signal this was grok_error, so the moment a user's
  // subscription session expired they were told to retry rather than to re-login.
  it('JSON type:error 401 "Invalid or expired credentials" maps to auth_error', async () => {
    const envelope = 'Internal error: "Unauthorized (401) from https://cli-chat-proxy.grok.com/v1/responses: Invalid or expired credentials (auth_kind=bearer, x_xai_token_auth=xai-grok-cli, upstream=PermissionDenied, reason=no auth context)\n\n  Model:     grok-4.6\n  Auth:      Oidc\n  Version:   1.0.13\n\nAuthentication is temporarily unavailable (often a network blip right after wake). Your session is still signed in and will recover automatically — retry in a few seconds; no need to run /login."';
    const stdout = JSON.stringify({ type: 'error', message: envelope });
    const r = await runDelegate('subscription', input, deps({ code: 1, stdout, stderr: `Error: ${envelope}` }));
    expect(r.status).toBe('auth_error');
    expect(r.message).toMatch(/grok login/);
    // The CLI's misleading trailer must not reach the user as our guidance.
    expect(r.message).not.toMatch(/no need to run/);
  });
  it('JSON type:error with unrelated message stays grok_error', async () => {
    const stdout = JSON.stringify({ type: 'error', message: 'Internal compiler panic in tool X' });
    const r = await runDelegate('subscription', input, deps({ code: 1, stdout, stderr: '' }));
    expect(r.status).toBe('grok_error');
  });

  // M1 — billing invariant guarded through the delegate path (not just buildGrokEnv in isolation)
  it('subscription mode spawns grok with an API-key-stripped env (billing invariant)', async () => {
    let capturedEnv: NodeJS.ProcessEnv | undefined;
    const capSpawn: SpawnFn = async (_a, _c, env) => { capturedEnv = env; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    await runDelegate('subscription', input, {
      spawn: capSpawn, gitChangedFiles: () => [], dirExists: () => true,
      env: { PATH: '/usr/bin', XAI_API_KEY: 'sk-x', GROK_CODE_XAI_API_KEY: 'sk-y' },
    });
    expect(capturedEnv?.XAI_API_KEY).toBeUndefined();
    expect(capturedEnv?.GROK_CODE_XAI_API_KEY).toBeUndefined();
    // PATH is preserved through the delegate path (now with the grok bin dir prepended —
    // exact prepend format is asserted in env.test.ts); the original entry must survive.
    expect(capturedEnv?.PATH).toContain('/usr/bin');
  });
  it('api mode spawns grok with the API keys passed through', async () => {
    let capturedEnv: NodeJS.ProcessEnv | undefined;
    const capSpawn: SpawnFn = async (_a, _c, env) => { capturedEnv = env; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    await runDelegate('api', input, {
      spawn: capSpawn, gitChangedFiles: () => [], dirExists: () => true,
      env: { XAI_API_KEY: 'sk-x', GROK_CODE_XAI_API_KEY: 'sk-y' },
    });
    expect(capturedEnv?.XAI_API_KEY).toBe('sk-x');
    expect(capturedEnv?.GROK_CODE_XAI_API_KEY).toBe('sk-y');
  });
  // A34 — the worker grok starts a copy of this server; the marker is how that copy knows.
  it('spawns grok with the grok-build worker marker', async () => {
    let capturedEnv: NodeJS.ProcessEnv | undefined;
    const capSpawn: SpawnFn = async (_a, _c, env) => { capturedEnv = env; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    await runDelegate('subscription', input, {
      spawn: capSpawn, gitChangedFiles: () => [], dirExists: () => true,
      env: { PATH: '/usr/bin' },
    });
    expect(capturedEnv?.GROK_BUILD_WORKER).toBe('1');
  });

  // M2 — mandatory flags + injection-safe positional args
  it('always passes the mandatory grok flags and passes prompt/cwd as distinct args', async () => {
    let capturedArgs: string[] = [];
    const capSpawn: SpawnFn = async (args) => { capturedArgs = args; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    await runDelegate('subscription', input, { spawn: capSpawn, gitChangedFiles: () => [], dirExists: () => true });
    expect(capturedArgs).toContain('--no-auto-update');
    expect(capturedArgs).toContain('--always-approve');
    expect(capturedArgs[capturedArgs.indexOf('--output-format') + 1]).toBe('json');
    expect(capturedArgs[capturedArgs.indexOf('--cwd') + 1]).toBe(input.cwd);
    // A32: the token now carries NO_COMMIT_PROMPT_SUFFIX after the prompt, so this asserts the
    // two things it always meant — the equals form, and the caller's prompt reaching grok
    // verbatim at the head of it — instead of the whole token being the prompt.
    expect(capturedArgs.some((a) => a.startsWith(`--single=${input.prompt}`))).toBe(true);
  });

  // L4 — cwd validation before spawn
  it('rejects a non-absolute cwd without spawning grok', async () => {
    let spawned = false;
    const spy: SpawnFn = async () => { spawned = true; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    const r = await runDelegate('subscription', { prompt: 'x', cwd: 'relative/path' }, { spawn: spy, gitChangedFiles: () => [], dirExists: () => true });
    expect(r.status).toBe('grok_error');
    expect(spawned).toBe(false);
  });
  it('rejects a cwd that does not exist without spawning grok', async () => {
    let spawned = false;
    const spy: SpawnFn = async () => { spawned = true; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    const r = await runDelegate('subscription', input, { spawn: spy, gitChangedFiles: () => [], dirExists: () => false });
    expect(r.status).toBe('grok_error');
    expect(spawned).toBe(false);
  });

  // L3 — spawn failure classified distinctly from unparseable output
  it('classifies a spawn failure distinctly (not an opaque parse error)', async () => {
    const r = await runDelegate('subscription', input, deps({ spawnError: true, code: -1, stdout: '', stderr: 'spawn grok ENOENT' }));
    expect(r.status).toBe('grok_error');
    expect(r.message).toMatch(/시작할 수 없|프로세스/);
    expect(r.rawStderrTail).toContain('ENOENT');
  });

  // M3 — partial edits surfaced on abort paths
  it('surfaces filesChanged on timeout so partial edits are not hidden', async () => {
    const r = await runDelegate('subscription', input, deps({ timedOut: true, code: null }, ['partial.ts']));
    expect(r.status).toBe('timeout');
    expect(r.filesChanged).toEqual(['partial.ts']);
  });
  it('surfaces filesChanged when grok stops non-EndTurn with partial edits', async () => {
    const r = await runDelegate('subscription', input, deps({ code: 0, stdout: okJson({ stopReason: 'Cancelled' }) }, ['half.ts']));
    expect(r.status).toBe('grok_error');
    expect(r.filesChanged).toEqual(['half.ts']);
  });
  it('surfaces filesChanged on parse-fail auth_error so partial edits are not hidden', async () => {
    const r = await runDelegate(
      'subscription',
      input,
      deps({ stdout: '', stderr: 'Error: not authenticated' }, ['half.ts']),
    );
    expect(r.status).toBe('auth_error');
    expect(r.filesChanged).toEqual(['half.ts']);
  });

  // L7 — auth-signal false positive removed
  it('does not misclassify a 403 in grok output as an auth error', async () => {
    const r = await runDelegate('subscription', input, deps({ stdout: 'wrote a handler returning res.status(403)', stderr: 'compile failed' }));
    expect(r.status).toBe('grok_error');
  });

  // Failure-mode message text (roadmap Phase 2 done-definition)
  it('timeout message includes the seconds and how to retry', async () => {
    const r = await runDelegate('subscription', input, deps({ timedOut: true, code: null }));
    expect(r.message).toMatch(/초 내에 끝나지 않/);
    expect(r.message).toContain('timeout_ms');
  });
  it('auth_error (subscription) message tells the user to run grok login', async () => {
    const r = await runDelegate('subscription', input, deps({ stdout: '', stderr: 'not authenticated' }));
    expect(r.status).toBe('auth_error');
    expect(r.message).toContain('grok login');
  });

  // Phase 3 — worktree isolation
  it('worktree mode runs grok in the created worktree and derives filesChanged there', async () => {
    let capturedArgs: string[] = [];
    let capturedCwd = '';
    let gitCalls = 0;
    const capSpawn: SpawnFn = async (args, cwd) => { capturedArgs = args; capturedCwd = cwd; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    const r = await runDelegate('subscription', { prompt: 'do x', cwd: '/abs/repo', worktree: true }, {
      spawn: capSpawn, dirExists: () => true,
      createWorktree: async () => '/wt/path',
      // before clean, after dirty in the worktree only
      gitChangedFiles: (cwd) => {
        if (cwd !== '/wt/path') return [];
        gitCalls += 1;
        return gitCalls === 1 ? [] : ['a.ts'];
      },
    });
    expect(r.status).toBe('completed');
    expect(r.worktreePath).toBe('/wt/path');
    expect(r.filesChanged).toEqual(['a.ts']);
    expect(capturedCwd).toBe('/wt/path');
    expect(capturedArgs[capturedArgs.indexOf('--cwd') + 1]).toBe('/wt/path');
  });
  it('worktree creation failure returns grok_error without spawning grok', async () => {
    let spawned = false;
    const spy: SpawnFn = async () => { spawned = true; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    const r = await runDelegate('subscription', { prompt: 'x', cwd: '/abs/repo', worktree: true }, {
      spawn: spy, dirExists: () => true, gitChangedFiles: () => [],
      createWorktree: async () => { throw new Error('not a git repo'); },
    });
    expect(r.status).toBe('grok_error');
    expect(r.message).toMatch(/worktree/);
    expect(spawned).toBe(false);
  });

  // Phase 3 — sandbox pass-through (built-in profile names from grok docs)
  it('passes --sandbox <profile> when sandbox is set, and omits it otherwise', async () => {
    let withArgs: string[] = [];
    const cap: SpawnFn = async (args) => { withArgs = args; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    await runDelegate('subscription', { prompt: 'x', cwd: '/tmp/proj', sandbox: 'workspace' }, { spawn: cap, dirExists: () => true, gitChangedFiles: () => [] });
    expect(withArgs[withArgs.indexOf('--sandbox') + 1]).toBe('workspace');
    let noArgs: string[] = [];
    const cap2: SpawnFn = async (args) => { noArgs = args; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    await runDelegate('subscription', { prompt: 'x', cwd: '/tmp/proj' }, { spawn: cap2, dirExists: () => true, gitChangedFiles: () => [] });
    expect(noArgs).not.toContain('--sandbox');
  });
  it('accepts built-in hyphenated profile read-only', async () => {
    let args: string[] = [];
    const cap: SpawnFn = async (a) => { args = a; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    const r = await runDelegate('subscription', { prompt: 'x', cwd: '/tmp/proj', sandbox: 'read-only' }, {
      spawn: cap, dirExists: () => true, gitChangedFiles: () => [],
    });
    expect(r.status).toBe('completed');
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
  });

  // Phase 3 — plan mode
  it('plan mode uses --permission-mode plan (not --always-approve) and treats Cancelled+text as completed; skips git status', async () => {
    let args: string[] = [];
    const cap: SpawnFn = async (a) => { args = a; return { code: 0, stdout: JSON.stringify({ text: 'Plan: add hello()', stopReason: 'Cancelled' }), stderr: '', timedOut: false }; };
    const r = await runDelegate('subscription', { prompt: 'x', cwd: '/tmp/proj', plan: true }, {
      spawn: cap, dirExists: () => true, gitChangedFiles: () => ['should-be-ignored.ts'],
    });
    expect(args).toContain('--permission-mode');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('plan');
    expect(args).not.toContain('--always-approve');
    expect(r.status).toBe('completed');
    expect(r.summary).toBe('Plan: add hello()');
    expect(r.filesChanged).toEqual([]);
  });
  it('plan mode with empty text maps to grok_error', async () => {
    const r = await runDelegate('subscription', { prompt: 'x', cwd: '/tmp/proj', plan: true }, deps({ stdout: JSON.stringify({ text: '', stopReason: 'Cancelled' }) }));
    expect(r.status).toBe('grok_error');
  });

  // A50 (MEASURED 2026-09-30, and again 2026-10-04 through the shipped v0.2.38 bundle on grok 1.0.44 and
  // 1.0.46 with a mock model forcing the calls): under --permission-mode plan grok still ran every tool call
  // the user's own allow rules approved — a push, a gh call and an MCP call left no trace in the result.
  // These four rules closed every measured path but `scheduler_create` and `workflow` on grok 1.0.13/1.0.30
  // (contract §1, §6; docs/10 A60). The rules are compared against LITERALS
  // on purpose: grok drops a rule name it does not know without a word, so a test that imported the
  // production constant would stay green with the same typo on both sides.
  describe('A50 — every plan spawn passes the four deny rules, and only plan spawns do', () => {
    const DENY = ['--deny', 'Bash', '--deny', 'Edit', '--deny', 'Write', '--deny', 'MCPTool(*)'];
    const emptyIndex = { listSessionDirs: () => [], sessionDirHasId: () => false };
    const capture = async (over: Record<string, unknown>, extra: Partial<DelegateDeps> = {}): Promise<string[]> => {
      let args: string[] = [];
      const cap: SpawnFn = async (a) => {
        args = a;
        return { code: 0, stdout: JSON.stringify({ text: 'the plan', stopReason: 'end_turn' }), stderr: '', timedOut: false };
      };
      await runDelegate('subscription', { prompt: 'x', cwd: '/tmp/proj', ...over } as Parameters<typeof runDelegate>[1], {
        spawn: cap, dirExists: () => true, gitChangedFiles: () => [], sessionsIndex: emptyIndex, ...extra,
      });
      return args;
    };
    const afterPermissionMode = (args: string[]) => {
      const i = args.indexOf('--permission-mode');
      return i < 0 ? [] : args.slice(i, i + 2 + DENY.length);
    };

    // The marker proves the run really took that branch — without it a case that fell through to a fresh
    // plan would pass for the wrong reason.
    it.each([
      ['a fresh plan', { plan: true }, '--session-id'],
      ['a resumed plan', { plan: true, resumeSessionId: 'sess-1' }, '--resume'],
      ['a continued plan', { plan: true, continueSession: true }, '--continue'],
      ['a sandboxed plan', { plan: true, sandbox: 'read-only' }, '--sandbox'],
    ])('%s carries them right after --permission-mode plan, once each', async (_name, over, marker) => {
      const args = await capture(over);
      expect(args).toContain(marker);
      expect(afterPermissionMode(args)).toEqual(['--permission-mode', 'plan', ...DENY]);
      expect(args.filter((a) => a === '--deny')).toHaveLength(4);
      expect(args).not.toContain('--always-approve');
    });

    it('a plan run in a worktree carries them', async () => {
      const args = await capture({ plan: true, worktree: true, cwd: '/abs/repo' }, { createWorktree: async () => '/wt/path' });
      expect(args[args.indexOf('--cwd') + 1]).toBe('/wt/path');
      expect(afterPermissionMode(args)).toEqual(['--permission-mode', 'plan', ...DENY]);
      expect(args.filter((a) => a === '--deny')).toHaveLength(4);
      expect(args).not.toContain('--always-approve');
    });

    it('a plan whose prompt travels through --prompt-file carries them', async () => {
      const args = await capture({ plan: true, prompt: 'y'.repeat(ARGV_PROMPT_LIMIT_POSIX_BYTES + 1) });
      expect(args).toContain('--prompt-file');
      expect(afterPermissionMode(args)).toEqual(['--permission-mode', 'plan', ...DENY]);
      expect(args.filter((a) => a === '--deny')).toHaveLength(4);
      expect(args).not.toContain('--always-approve');
    });

    it.each([
      ['a delegation', {}],
      ['a verification', { check: true }],
      ['a resumed delegation', { resumeSessionId: 'sess-1' }],
      ['a continued delegation', { continueSession: true }],
    ])('%s does not carry them and still approves edits', async (_name, over) => {
      const args = await capture(over);
      expect(args).not.toContain('--deny');
      expect(args).toContain('--always-approve');
    });
  });

  // Phase 3 — self-verification (CLI 1.0: prompt suffix, no --check)
  it('check mode appends a verify instruction (not --check) and stays completed with git files', async () => {
    let args: string[] = [];
    let gitCalls = 0;
    const cap: SpawnFn = async (a) => { args = a; return { code: 0, stdout: okJson({ text: 'done + verified' }), stderr: '', timedOut: false }; };
    const r = await runDelegate('subscription', { prompt: 'x', cwd: '/tmp/proj', check: true }, {
      spawn: cap, dirExists: () => true,
      gitChangedFiles: () => { gitCalls += 1; return gitCalls === 1 ? [] : ['math.js']; },
    });
    expect(args).not.toContain('--check');
    expect(args).toContain('--always-approve');
    const p = args.find((a) => a.startsWith('--single='))!.slice('--single='.length);
    expect(p).toContain('x');
    expect(p).toMatch(/Verification checklist/i);
    expect(r.status).toBe('completed');
    expect(r.summary).toBe('done + verified');
    expect(r.filesChanged).toEqual(['math.js']);
  });
  it('omits --check when check is not set', async () => {
    let args: string[] = [];
    const cap: SpawnFn = async (a) => { args = a; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    await runDelegate('subscription', { prompt: 'x', cwd: '/tmp/proj' }, { spawn: cap, dirExists: () => true, gitChangedFiles: () => [] });
    expect(args).not.toContain('--check');
    expect(args.some((a) => a.startsWith('--single=x'))).toBe(true);
  });

  // Phase 3.5 Slice B — filesChanged delta, sessionId, safe CLI flags
  it('filesChanged is after \\ before (excludes pre-existing dirty paths)', async () => {
    let gitCalls = 0;
    const r = await runDelegate('subscription', input, {
      spawn: fakeSpawn({ stdout: okJson() }),
      dirExists: () => true,
      gitChangedFiles: () => {
        gitCalls += 1;
        return gitCalls === 1 ? ['pre-existing.ts'] : ['pre-existing.ts', 'new-from-grok.ts'];
      },
    });
    expect(r.status).toBe('completed');
    expect(r.filesChanged).toEqual(['new-from-grok.ts']);
  });
  it('surfaces sessionId from grok JSON when present', async () => {
    const r = await runDelegate('subscription', input, deps({ stdout: okJson({ sessionId: 'sess-abc' }) }));
    expect(r.sessionId).toBe('sess-abc');
  });
  it('passes model, effort, resume as argv when valid', async () => {
    let args: string[] = [];
    const cap: SpawnFn = async (a) => { args = a; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    await runDelegate('subscription', {
      prompt: 'x', cwd: '/tmp/proj', model: 'grok-4.6', effort: 'high', resumeSessionId: 'sess-1',
    }, { spawn: cap, dirExists: () => true, gitChangedFiles: () => [] });
    expect(args[args.indexOf('--model') + 1]).toBe('grok-4.6');
    expect(args[args.indexOf('--effort') + 1]).toBe('high');
    expect(args).not.toContain('--best-of-n');
    expect(args[args.indexOf('--resume') + 1]).toBe('sess-1');
  });
  it('omits --model for retired alias grok-build (CLI default)', async () => {
    let args: string[] = [];
    const cap: SpawnFn = async (a) => { args = a; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    const r = await runDelegate('subscription', {
      prompt: 'x', cwd: '/tmp/proj', model: 'grok-build',
    }, { spawn: cap, dirExists: () => true, gitChangedFiles: () => [] });
    expect(r.status).toBe('completed');
    expect(args).not.toContain('--model');
  });
  it('passes --continue when continueSession is true', async () => {
    let args: string[] = [];
    const cap: SpawnFn = async (a) => { args = a; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    await runDelegate('subscription', { prompt: 'x', cwd: '/tmp/proj', continueSession: true }, {
      spawn: cap, dirExists: () => true, gitChangedFiles: () => [],
    });
    expect(args).toContain('--continue');
  });
  // This rejection is LOAD-BEARING FOR ANOTHER FILE, and nothing said so until 2026-09-23.
  //
  // `.claude/tools/accept-release.mjs` promises "spawns no grok process and spends no subscription
  // quota", and it keeps that promise by sending `best_of_n: 2` on its delegate/plan/verify probes.
  // `best_of_n` is a DECLARED field (server.ts strengthFields), so it passes the tool schema and is
  // stopped here — measured 2026-09-23 through the shipped bundle, which returned this exact
  // message. Remove or soften this branch and that tool starts making three real, billed
  // delegations every time anyone grades a release.
  //
  // The two files never reference each other, so this test is the link. It reads the probe payloads
  // out of the acceptance tool rather than restating them: a maintainer who changes them there,
  // instead of here, still gets told.
  //
  // FOUND BY GROK, partly. Put the coupling to it and it answered False on both halves. It was
  // right that my comment above describes the removed BOUNDS rather than the validator, and I had
  // overstated that. It was wrong that "dying on an unknown key is not this validator" — it assumed
  // best_of_n was an unknown key. Measurement settled which half was which.
  it('the acceptance tool still relies on this rejection to stay quota-free', () => {
    const tool = readFileSync(join(repoRoot, '.claude/tools/accept-release.mjs'), 'utf8');
    // Normalise rather than pattern-match: the promise wraps across a comment line, so a regex
    // has to know about ` * ` continuations. Collapsing first is both simpler and harder to
    // silently break — this repo has shipped a dead regex before (A31).
    const flat = tool.replace(/\r?\n\s*\*?/g, ' ').replace(/\s+/g, ' ');
    expect(flat).toContain('spends no subscription quota');
    for (const t of ['grok_build_delegate', 'grok_build_plan', 'grok_build_verify']) {
      // EVERY payload, not the first line that happens to match: a probe added later (A34's is
      // one) must not be able to drop the guard while an older line keeps this test green — and a
      // call wrapped across lines must count too, so this reads the FLATTENED file (two review
      // findings, 2026-09-24). A payload is the object literal right after `'<tool>',`; a bare
      // mention such as props('grok_build_plan') has none. The payloads here are flat literals.
      const needle = `'${t}'`;
      const payloads: string[] = [];
      for (let i = flat.indexOf(needle); i !== -1; i = flat.indexOf(needle, i + 1)) {
        const after = flat.slice(i + needle.length).trimStart();
        if (!after.startsWith(',')) continue;
        const rest = after.slice(1).trimStart();
        if (!rest.startsWith('{')) continue;
        payloads.push(rest.slice(0, rest.indexOf('}') + 1));
      }
      expect(payloads.length, `${t}: no probe payload found in accept-release.mjs`).toBeGreaterThan(0);
      for (const p of payloads) expect(p, `${t} probe without best_of_n: ${p}`).toContain('best_of_n');
    }
    // And the rejection those payloads depend on is still a refusal, not a pass-through.
    const r = validateDelegateOptions({ prompt: 'x', cwd: '/abs', bestOfN: 2 });
    expect(r.ok, 'validateDelegateOptions stopped refusing best_of_n — accept-release now bills').toBe(false);
  });

  it('rejects any best_of_n without spawning (CLI 1.0 removed --best-of-n)', async () => {
    let spawned = false;
    const spy: SpawnFn = async () => { spawned = true; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    for (const n of [2, 4, 9]) {
      spawned = false;
      const r = await runDelegate('subscription', { prompt: 'x', cwd: '/tmp/proj', bestOfN: n }, {
        spawn: spy, dirExists: () => true, gitChangedFiles: () => [],
      });
      expect(r.status).toBe('grok_error');
      expect(r.message).toMatch(/best_of_n/);
      expect(spawned).toBe(false);
    }
  });
  it('rejects resume+continue together without spawning', async () => {
    let spawned = false;
    const spy: SpawnFn = async () => { spawned = true; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    const r = await runDelegate('subscription', {
      prompt: 'x', cwd: '/tmp/proj', resumeSessionId: 's1', continueSession: true,
    }, { spawn: spy, dirExists: () => true, gitChangedFiles: () => [] });
    expect(r.status).toBe('grok_error');
    expect(spawned).toBe(false);
  });
  it('rejects shell-ish model tokens without spawning (injection defense)', async () => {
    let spawned = false;
    const spy: SpawnFn = async () => { spawned = true; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    const r = await runDelegate('subscription', { prompt: 'x', cwd: '/tmp/proj', model: 'x; rm -rf /' }, {
      spawn: spy, dirExists: () => true, gitChangedFiles: () => [],
    });
    expect(r.status).toBe('grok_error');
    expect(spawned).toBe(false);
  });
});

describe('diffChangedFiles', () => {
  it('returns after when before is empty', () => {
    expect(diffChangedFiles([], ['a.ts'])).toEqual(['a.ts']);
  });
  it('drops paths present in before', () => {
    expect(diffChangedFiles(['old.ts'], ['old.ts', 'new.ts'])).toEqual(['new.ts']);
  });
});

describe('validateDelegateOptions', () => {
  it('accepts empty options', () => {
    expect(validateDelegateOptions({ prompt: 'x', cwd: '/a' }).ok).toBe(true);
  });
  it('rejects bestOfN outside 2..4', () => {
    expect(validateDelegateOptions({ prompt: 'x', cwd: '/a', bestOfN: 1 }).ok).toBe(false);
    expect(validateDelegateOptions({ prompt: 'x', cwd: '/a', bestOfN: 5 }).ok).toBe(false);
  });
  it('accepts known sandbox profiles including read-only', () => {
    for (const p of ['off', 'workspace', 'devbox', 'read-only', 'strict']) {
      expect(validateDelegateOptions({ prompt: 'x', cwd: '/a', sandbox: p }).ok, p).toBe(true);
    }
  });
  it('passes through model names that collide with Object.prototype keys', () => {
    // `model in RETIRED_MODEL_ALIASES` walks the prototype chain, so these names were
    // silently treated as retired and --model was dropped instead of forwarded to grok.
    for (const m of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
      const r = validateDelegateOptions({ prompt: 'x', cwd: '/a', model: m });
      expect(r.ok, m).toBe(true);
      expect(r.ok && r.extraArgs, m).toEqual(['--model', m]);
    }
  });
  it('still omits --model for the genuinely retired grok-build alias', () => {
    const r = validateDelegateOptions({ prompt: 'x', cwd: '/a', model: 'grok-build' });
    expect(r.ok).toBe(true);
    expect(r.ok && r.extraArgs).toEqual([]);
  });
});

describe('looksLikeAuthFailure', () => {
  it('detects modern Not signed in envelope', () => {
    expect(looksLikeAuthFailure('Not signed in. run grok login --device-code')).toBe(true);
  });
  it('detects device-flow URL', () => {
    expect(looksLikeAuthFailure('https://accounts.x.ai/oauth2/device?user_code=AB')).toBe(true);
  });
  it('detects the rejected-session 401 credential phrase', () => {
    expect(looksLikeAuthFailure('Unauthorized (401) ...: Invalid or expired credentials (auth_kind=none)')).toBe(true);
  });
  it('ignores ordinary build output', () => {
    expect(looksLikeAuthFailure('error: compile failed status 403')).toBe(false);
  });
  // The signal matches the credential wording, not the status code — a bare 401/403 from a
  // service the task happens to call must stay a grok_error.
  it('ignores a bare 401 with no credential wording', () => {
    expect(looksLikeAuthFailure('fetch failed: Unauthorized (401) from https://example.test/api')).toBe(false);
  });
});

describe('isTimedOutDeviceAuth', () => {
  it('true only for device-flow stderr markers', () => {
    expect(isTimedOutDeviceAuth('Waiting for authorization...')).toBe(true);
    expect(isTimedOutDeviceAuth('https://accounts.x.ai/oauth2/device?x=1')).toBe(true);
    expect(isTimedOutDeviceAuth('please run grok login')).toBe(false);
  });
});

describe('parsePorcelain (git status --porcelain -z, core.quotepath=false)', () => {
  it('parses modified / added / untracked paths', () => {
    expect(parsePorcelain(' M a.ts\0A  b.ts\0?? c.ts\0')).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });
  it('returns the NEW path for renames and skips the original', () => {
    expect(parsePorcelain('R  renamed.txt\0orig.txt\0')).toEqual(['renamed.txt']);
  });
  it('preserves spaces and unicode (no C-quoting)', () => {
    expect(parsePorcelain('A  with space.txt\0?? café.txt\0')).toEqual(['with space.txt', 'café.txt']);
  });
  it('handles blank input and a trailing NUL', () => {
    expect(parsePorcelain('')).toEqual([]);
    expect(parsePorcelain(' M x\0')).toEqual(['x']);
  });
  // A45 (docs/10, MEASURED 2026-09-25 with git 2.45.1): a rename in the WORK TREE — an intent-to-add
  // path (`mv a.txt b.txt && git add -N b.txt`) — carries its R in the SECOND status column, ` R`.
  // Only the first column was checked, so the original-path field was read as an entry of its own,
  // and `.slice(3)` of `a.txt` put a phantom `xt` into filesChanged. The payload is git's real output.
  it('skips the original path of a work-tree rename too (status column Y)', () => {
    expect(parsePorcelain(' R b.txt\0a.txt\0')).toEqual(['b.txt']);
    expect(parsePorcelain(' R new.txt\0old.txt\0 M other.ts\0')).toEqual(['new.txt', 'other.ts']);
  });
  it('real git: a work-tree rename lists only the new path', () => {
    const repo = mkdtempSync(join(tmpdir(), 'grok-porcelain-'));
    try {
      execFileSync('git', ['init', '-q', repo]);
      writeFileSync(join(repo, 'a.txt'), 'hello world content line\n'.repeat(5));
      execFileSync('git', ['-C', repo, 'add', 'a.txt']);
      execFileSync('git', ['-C', repo, '-c', 'user.email=a@b', '-c', 'user.name=t', 'commit', '-q', '-m', 'init']);
      renameSync(join(repo, 'a.txt'), join(repo, 'b.txt'));
      execFileSync('git', ['-C', repo, 'add', '-N', 'b.txt']);
      const z = execFileSync('git', ['-C', repo, '-c', 'core.quotepath=false', 'status', '--porcelain', '-z', '-uall'], { encoding: 'utf8' });
      expect(parsePorcelain(z)).toEqual(['b.txt']);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

// A39 (docs/10, MEASURED 2026-09-25 through the shipped v0.2.35 bundle): a 40,000-char delegation on
// Windows came back as a bare "spawn ENAMETOOLONG" — no mode, no billing, no history row. spawn()
// THROWS (instead of emitting 'error') for ENAMETOOLONG / E2BIG and for a NUL in an argument, so the
// promise rejected past every classification. Two halves: the throw becomes a structured spawn error,
// and a long prompt no longer rides on argv at all.
describe('A39 — a spawn that throws is a structured spawn error, not a rejection', () => {
  it('a NUL in an argument (throws on every platform)', async () => {
    const r = await spawnBounded(process.execPath, ['-e', '0', 'a\0b'], tmpdir(), process.env, 5000);
    expect(r.spawnError).toBe(true);
    expect(r.code).toBe(-1);
    expect(r.stderr.length).toBeGreaterThan(0);
  });
  it.skipIf(process.platform !== 'win32')('the measured payload: a 40,000-char argument on Windows', async () => {
    const r = await spawnBounded(process.execPath, ['-e', '0', `--single=${'x'.repeat(40_000)}`], tmpdir(), process.env, 5000);
    expect(r.spawnError).toBe(true);
    expect(r.stderr).toMatch(/ENAMETOOLONG/);
  });
  // The re-review, on win32: with an existing cwd of 260+ characters the child cannot start and its pipes
  // then emit ENOTCONN — with no listener on them that 'error' ended the MCP server (exit 1, measured
  // through the shipped bundle). Pre-existing since 418c1e9. Skipped where such a folder cannot be made.
  it.skipIf(process.platform !== 'win32')('an existing cwd of 260+ characters is a spawn error, not a crash', async (ctx) => {
    let dir = mkdtempSync(join(tmpdir(), 'grok-longcwd-'));
    const base = dir;
    while (dir.length < 270) dir = join(dir, 'd'.repeat(30));
    try { mkdirSync(dir, { recursive: true }); } catch { ctx.skip(); }
    try {
      const r = await spawnBounded(process.execPath, ['-e', '0'], dir, process.env, 5000);
      await new Promise((ok) => setTimeout(ok, 200)); // a late pipe 'error' would fire here
      expect(r.spawnError).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
  // Round 3: that spawn error reads `spawn grok ENOENT` — "not found": grok_cli said to check the install or
  // PATH, and delegate passed on the bare ENOENT. Measured with node itself: 258 characters start, 259 do not.
  it('a start that failed on a Windows path of 259+ characters says so, not "check the install"', () => {
    const long = 'C:\\' + 'd'.repeat(300);
    expect(longCwdHint(long, 'spawn grok ENOENT', 'win32')).toContain(String(long.length));
    expect(longCwdHint('C:\\' + 'd'.repeat(250), 'spawn grok ENOENT', 'win32')).toBeUndefined();
    expect(longCwdHint(long, 'spawn grok EMFILE', 'win32')).toBeUndefined();
    expect(longCwdHint('/' + 'd'.repeat(300), 'spawn grok ENOENT', 'linux')).toBeUndefined();
  });
  // Round 4: the measured boundary itself — a change to 260 passed every test above. A plain UNC folder fails
  // from 259 the same way (round 5, `\\localhost\C$\…`).
  it('the hint starts at 259 characters, for a drive or a UNC path', () => {
    expect(longCwdHint('C:\\' + 'd'.repeat(255), 'spawn grok ENOENT', 'win32')).toBeUndefined();
    expect(longCwdHint('C:\\' + 'd'.repeat(256), 'spawn grok ENOENT', 'win32')).toContain('259자');
    expect(longCwdHint('\\\\srv\\share\\' + 'd'.repeat(300), 'spawn grok ENOENT', 'win32')).toContain('259자');
  });
  // Round 6: an extended-length `\\?\` folder fails at exactly 259 characters, prefix counted, and from 260
  // when its 8.3 short form is 259 or more — on a volume without short names, from 259 like a drive path.
  // Node cannot read the short form, so from 259 it gets a hint that names both causes (round 5 hinted only
  // from 259 WITHOUT the prefix — measured on one folder shape — and missed 259 to 262, 259 to 264 for `\\?\UNC\`).
  it('a \\\\?\\ path gets a hint from 259 characters, naming the short name and the install', () => {
    const at = (n: number) => '\\\\?\\C:\\' + 'd'.repeat(n - 7);
    expect(longCwdHint(at(258), 'spawn grok ENOENT', 'win32')).toBeUndefined();
    const hint = longCwdHint(at(259), 'spawn grok ENOENT', 'win32');
    expect(hint).toContain('259자');
    expect(hint).toContain('8.3');
    expect(hint).toContain('설치');
    expect(longCwdHint('\\\\?\\UNC\\srv\\share\\' + 'd'.repeat(241), 'spawn grok ENOENT', 'win32')).toContain('8.3');
    expect(longCwdHint(at(300), 'spawn grok EMFILE', 'win32')).toBeUndefined();
  });
  // Round 7: the numbers in both texts, read at a length that is not 259 — `toContain('259자')` above was met by
  // "259자입니다", the path's own length, and 258 or 260 in the rule passed every test.
  it('the hint texts, word for word', () => {
    const extended = '\\\\?\\C:\\' + 'd'.repeat(293);
    expect(longCwdHint(extended, 'spawn grok ENOENT', 'win32')).toBe(
      '작업 폴더 경로가 300자입니다 — Windows는 \\\\?\\ 경로도 259자에서, 그보다 길면 짧은(8.3) 이름이 259자 이상일 때 '
      + '프로세스를 시작하지 못하고, 그 실패를 ENOENT로 알립니다. grok 설치/PATH가 맞다면 더 짧은 경로에서 실행하세요.');
    expect(longCwdHint('C:\\' + 'd'.repeat(297), 'spawn grok ENOENT', 'win32')).toBe(
      '작업 폴더 경로가 300자입니다 — Windows는 259자 이상인 작업 폴더에서 프로세스를 시작하지 못하고, '
      + '그 실패를 ENOENT로 알립니다. 더 짧은 경로에서 실행하세요.');
  });
  // Round 7: the error code comes from Node's fixed wording — `spawn <file> <CODE>` for an 'error' event,
  // `spawn <CODE>` when spawn throws. The NUL error is a TypeError that QUOTES the argument, so a prompt about
  // "the ENOENT in loader.ts" from a 300-character folder got the long-folder hint (every version since round 3).
  it('the code is read from Node\'s wording, not searched for in the text', () => {
    expect(spawnErrorCode('spawn grok ENOENT')).toBe('ENOENT');
    expect(spawnErrorCode('spawn EFTYPE')).toBe('EFTYPE');
    expect(spawnErrorCode('spawn E2BIG')).toBe('E2BIG');
    const nul = "The argument 'args[2]' must be a string without null bytes. Received 'fix the ENOENT in loader.ts\\x00'";
    expect(spawnErrorCode(nul)).toBeUndefined();
    expect(longCwdHint('C:\\' + 'd'.repeat(297), nul, 'win32')).toBeUndefined();
    expect(spawnErrorCode('ENOENT')).toBeUndefined();
  });
  it.skipIf(process.platform !== 'win32')('runDelegate puts that hint in the message', async () => {
    const cwd = 'C:\\' + 'd'.repeat(300);
    const r = await runDelegate('subscription', { prompt: 'do x', cwd }, deps({ spawnError: true, code: -1, stdout: '', stderr: 'spawn grok ENOENT' }));
    expect(r.status).toBe('grok_error');
    expect(r.message).toContain(`${cwd.length}자`);
    expect(r.message).not.toContain('PATH');
  });
});

describe('A39 — a long prompt reaches grok through a private file, not argv', () => {
  const withSpawn = (spawn: SpawnFn): DelegateDeps => ({ ...deps({}), spawn });
  // Over the limit on every platform: past win32's units and past the POSIX bytes.
  const OVER = ARGV_PROMPT_LIMIT_POSIX_BYTES;

  it('above the limit: --prompt-file with the exact prompt, and the file is gone afterwards', async () => {
    const prompt = `${'x'.repeat(OVER)} — then reply LONG_OK`;
    let seenPath = '';
    let seenContent = '';
    let seenMode = 0;
    const r = await runDelegate('subscription', { prompt, cwd: '/tmp/proj' }, withSpawn(async (args) => {
      expect(args.some((a) => a.startsWith('--single'))).toBe(false);
      seenPath = args[args.indexOf('--prompt-file') + 1];
      seenContent = readFileSync(seenPath, 'utf8');
      seenMode = statSync(seenPath).mode & 0o777;
      return { code: 0, stdout: okJson(), stderr: '', timedOut: false };
    }));
    expect(r.status).toBe('completed');
    expect(seenContent.startsWith(prompt)).toBe(true); // the no-commit suffix follows, as on argv
    if (process.platform !== 'win32') expect(seenMode).toBe(0o600);
    expect(existsSync(seenPath), 'a leftover file would hold the whole prompt').toBe(false);
  });

  it('removes the file when the run fails too', async () => {
    let seenPath = '';
    let existedDuringRun = false;
    await runDelegate('subscription', { prompt: 'y'.repeat(OVER + 1), cwd: '/tmp/proj' },
      withSpawn(async (args) => {
        expect(args).toContain('--prompt-file'); // or the next line would read some other argument
        seenPath = args[args.indexOf('--prompt-file') + 1];
        existedDuringRun = existsSync(seenPath);
        return { code: null, stdout: '', stderr: '', timedOut: true };
      }));
    expect(existedDuringRun).toBe(true);
    expect(existsSync(seenPath)).toBe(false);
  });

  // Round 4: a version that removed the file only after the spawn RETURNED passed both tests above —
  // both spawns return. One that throws must not leave the whole prompt behind either.
  it('removes the file when the spawn itself throws', async () => {
    let seenPath = '';
    await expect(runDelegate('subscription', { prompt: 'y'.repeat(OVER + 1), cwd: '/tmp/proj' },
      withSpawn(async (args) => {
        expect(args).toContain('--prompt-file');
        seenPath = args[args.indexOf('--prompt-file') + 1];
        throw new Error('spawn blew up');
      }))).rejects.toThrow('spawn blew up');
    expect(seenPath).not.toBe('');
    expect(existsSync(seenPath)).toBe(false);
  });

  it('at or under the limit: the measured --single= path, unchanged', async () => {
    let args: string[] = [];
    await runDelegate('subscription', { prompt: 'z'.repeat(100), cwd: '/tmp/proj' },
      withSpawn(async (a) => { args = a; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; }));
    expect(args.some((a) => a.startsWith(`--single=${'z'.repeat(100)}`))).toBe(true);
    expect(args).not.toContain('--prompt-file');
  });

  // The pre-merge review: the first limit (8,000 everywhere) sent prompts argv carries fine through a
  // file that puts the whole prompt on disk. So the limit is per platform and close to what argv carries
  // there — almost exact on Linux (one argument, in bytes), sized for the worst-case quoting on win32
  // (the command line, in UTF-16 units), macOS not measured (the `promptFitsArgv` comment).
  it('win32 counts UTF-16 units; POSIX counts UTF-8 bytes', () => {
    const hangul = String.fromCharCode(0xD55C); // 1 unit, 3 bytes
    expect(promptFitsArgv('x'.repeat(ARGV_PROMPT_LIMIT_WIN32_UNITS), 'win32')).toBe(true);
    expect(promptFitsArgv('x'.repeat(ARGV_PROMPT_LIMIT_WIN32_UNITS + 1), 'win32')).toBe(false);
    expect(promptFitsArgv('x'.repeat(ARGV_PROMPT_LIMIT_POSIX_BYTES), 'linux')).toBe(true);
    expect(promptFitsArgv('x'.repeat(ARGV_PROMPT_LIMIT_POSIX_BYTES + 1), 'linux')).toBe(false);
    expect(promptFitsArgv(hangul.repeat(43_666), 'darwin')).toBe(true);   // 130,998 bytes
    expect(promptFitsArgv(hangul.repeat(43_667), 'darwin')).toBe(false);  // 131,001 bytes
    expect(promptFitsArgv('x'.repeat(20_000), 'linux')).toBe(true);       // went through a file before
  });

  // The limit is only right if argv really carries it here, in the costliest shape: on win32 every `"`
  // is quoted as `\"`, doubling the argument; on POSIX the count is already in bytes.
  it('this platform really carries a prompt at its limit, in the worst shape', async () => {
    // The limits must exist: without them `repeat(undefined)` is '' and the test would pass on nothing.
    expect(ARGV_PROMPT_LIMIT_WIN32_UNITS).toBeGreaterThan(10_000);
    expect(ARGV_PROMPT_LIMIT_POSIX_BYTES).toBeGreaterThan(100_000);
    const worst = process.platform === 'win32'
      ? '"'.repeat(ARGV_PROMPT_LIMIT_WIN32_UNITS)
      : 'x'.repeat(ARGV_PROMPT_LIMIT_POSIX_BYTES);
    // `--` so node hands the argument to the script instead of refusing it as its own option (exit 9).
    const r = await spawnBounded(process.execPath, ['-e', '0', '--', `--single=${worst}`], tmpdir(), process.env, 20_000);
    expect(r.spawnError).toBeUndefined();
    expect(r.code).toBe(0);
  });
});

// A59 (docs/10; contract §1 ③ — MEASURED 2026-10-12 on grok 1.0.50, win32 and Linux, zero quota, with a loopback that
// recorded what grok sent the model): a prompt of 99,977 bytes or more is not sent whole. grok writes it to
// <session>/prompts/prompt_<N>.txt and sends the model the beginning, the end and a note — on win32, when that path is
// 260 characters or more, a note that the file could not be saved, so the middle never reached the model. The shipped
// bundle said `completed` and nothing else. The fixtures are that measurement's: the numbered-line prompt, the session
// layout, the prompt file (the whole request between tags), the history line (the query as grok recorded it, its omission
// mark included), and grok's two notes verbatim.
describe('A59 — a request grok cut down is not reported as if the model saw all of it', () => {
  const NOT_SAVED = '[Full request could not be saved to a file — the excerpt above is truncated. Answer from it, '
    + 'and ask the user to resend the full content if anything essential is missing.]';
  const offloadedNote = (path: string) => '[Full request offloaded to file] This message contains only an excerpt of the '
    + `user's request; the complete request (100004 bytes, 1004 lines) is saved verbatim in:\n${path}\nLines of that file `
    + 'not in this message: user query lines 945–961. Read only those lines with `read_file` — offset=945, limit=17 — '
    + 'everything else is already in this message. Do not mention this file, the excerpt, or the omission to the user '
    + 'unless they ask or you could not read a part you needed.';
  /** grok's mark between the beginning and the end it kept, as its history line records it (measured on 1.0.50). */
  const OMISSION = '\n\n…[middle omitted — see the offload note for how to read it]…\n\n';
  const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
  const SUFFIX_BYTES = bytes(NO_COMMIT_PROMPT_SUFFIX);
  const label = (n: number) => `A59L${String(n).padStart(6, '0')}|`;
  /** Step 1's prompt: numbered lines, sized so the string grok gets — suffix included — is `total` bytes, plus `lead`. */
  const fixture = (total: number, { lead = '', hangul = false, head = '' } = {}) => {
    const budget = total - SUFFIX_BYTES - bytes(head);
    const full = (n: number) => label(n) + (hangul ? String.fromCharCode(0xD55C).repeat(29) : 'x'.repeat(88));
    const lines: string[] = [];
    let used = 0;
    for (let n = 1; ; n += 1) {
      const add = bytes(full(n)) + (lines.length ? 1 : 0);
      if (used + add + 12 > budget) {
        lines.push(label(n) + 'z'.repeat(budget - used - (lines.length ? 1 : 0) - 11));
        break;
      }
      lines.push(full(n));
      used += add;
    }
    const body = lines.join('\n');
    expect(bytes(body)).toBe(budget);
    return lead + head + body;
  };
  /** A distinct long prompt per run: the same lines, a different end. */
  const promptNo = (n: number) => fixture(100_500 + n);
  /** The string grok gets. */
  const sent = (prompt: string) => prompt + NO_COMMIT_PROMPT_SUFFIX;
  /** What grok keeps of the string it gets: the leading space, LF and U+0085 it trims (measured) gone; CRLF kept. */
  const LEADING = new RegExp(`^[ ${String.fromCharCode(10)}${String.fromCharCode(0x85)}]+`);
  const kept = (prompt: string) => sent(prompt).replace(LEADING, '');
  /** The query as grok records it: what it keeps — whole, or cut: its beginning, the mark and its end. */
  const recorded = (prompt: string, cut = true) => {
    const full = kept(prompt);
    return cut ? full.slice(0, Math.floor(full.length * 0.94)) + OMISSION + full.slice(full.length - Math.floor(full.length * 0.04)) : full;
  };

  const ENC = 'C%3A%5Cproj'; // a session folder name as grok writes it: the cwd, still encoded
  const homes: string[] = [];
  afterAll(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }); });
  const home = () => {
    const h = mkdtempSync(join(tmpdir(), 'a59-'));
    homes.push(h);
    return h;
  };
  const folderOf = (h: string, sid: string) => join(h, 'sessions', ENC, sid);
  const historyLine = (index: number, parts: string[]) =>
    `${JSON.stringify({ type: 'user', content: parts.map((text) => ({ type: 'text', text })), prompt_index: index })}\n`;
  /** grok's prompt file: the whole request it keeps, between tags (measured on 1.0.50). */
  const saveFile = (folder: string, index: number, prompt: string) => {
    mkdirSync(join(folder, 'prompts'), { recursive: true });
    writeFileSync(join(folder, 'prompts', `prompt_${index}.txt`), `<user_query>\n${kept(prompt)}\n</user_query>`);
  };
  /** What grok leaves for one turn: the prompt file when it cut the prompt, and the history line with its note. */
  const turn = (folder: string, index: number,
    { file, note, prompt, whole = false }: { file: boolean; note: string | null; prompt: string; whole?: boolean }) => {
    mkdirSync(join(folder, 'prompts'), { recursive: true });
    if (file) saveFile(folder, index, prompt);
    appendFileSync(join(folder, 'chat_history.jsonl'),
      historyLine(index, [`<user_query>\n${recorded(prompt, !whole)}\n</user_query>${note === null ? '' : `\n\n${note}`}`])
      + `${JSON.stringify({ type: 'assistant', content: 'done', model_id: 'grok-4.6' })}\n`);
  };
  const setTime = (path: string, offsetMs: number) => {
    const t = new Date(Date.now() + offsetMs);
    utimesSync(path, t, t);
  };
  /** A time as FAT keeps it: the even second at or before now — possibly before the spawn, in whole seconds. */
  const fatTime = (path: string) => {
    const t = new Date(Math.floor(Date.now() / 2_000) * 2_000);
    utimesSync(path, t, t);
  };
  /** A run whose grok calls `during` with its session id while it runs; a continue's session is grok's own. */
  const run = (prompt: string, h: string, during: (sid: string) => void, extra: Partial<DelegateInput> = {},
    ending: Partial<SpawnResult> = {}, reportedId?: string) => runDelegate('subscription', { prompt, cwd: '/tmp/proj', ...extra }, {
    ...deps({}),
    env: { GROK_HOME: h },
    spawn: async (args) => {
      const minted = args.includes('--session-id') ? args[args.indexOf('--session-id') + 1] : undefined;
      const sid = extra.resumeSessionId ?? minted ?? 'continued-session';
      during(sid);
      return { code: 0, stdout: JSON.stringify({ text: 'done', stopReason: 'end_turn', sessionId: reportedId ?? sid }), stderr: '', timedOut: false, ...ending };
    },
  });
  const TIMED_OUT: Partial<SpawnResult> = { timedOut: true, code: null, stdout: '' };
  /** This run's turn, cut, in its own session — grok's file note unless another is given. */
  const cut = (h: string, prompt: string, note: string = offloadedNote('p')) => (sid: string) =>
    turn(folderOf(h, sid), 0, { file: true, note, prompt });
  const STRONG = /닿지 않았/;
  const POINTED = /읽으라고/;
  const CLAIMS = /닿지 않았|읽으라고|이 실행의 grok 기록에 따르면/;
  /** The sentence that ties a file to this run, as opposed to the one that names files without tying them. */
  const ATTRIBUTED = /전문을 .*에 따로 저장했습니다/;
  const HEDGED = /잘랐을 수 있습니다/;
  /** Any of the sentences: each names a file, says grok saved the prompt, or says grok cut it. */
  const SILENT = /prompt_|저장|잘랐|잘라/;

  it('the measured boundary: 99,976 bytes say nothing, 99,977 bytes say grok cut the prompt', async () => {
    expect(OFFLOAD_MIN_BYTES).toBe(99_977);
    const h = home();
    // grok writes no file under the boundary; one is planted here so only the byte count can keep the note out.
    const under = fixture(99_976);
    expect((await run(under, h, cut(h, under))).message).toBeUndefined();
    const at = fixture(99_977);
    const r = await run(at, h, cut(h, at));
    expect(r.status).toBe('completed');
    expect(r.message).toContain(join(folderOf(h, r.sessionId!), 'prompts', 'prompt_0.txt'));
    expect(r.message).toContain('99,977');
    expect(r.message).toMatch(POINTED);
  });

  it('counts the string grok gets: the suffix in, nothing trimmed, UTF-8 bytes', async () => {
    const h = home();
    const p = fixture(99_977);
    expect(bytes(p)).toBe(99_977 - SUFFIX_BYTES); // the caller's prompt alone is under the boundary
    const withSuffix = await run(p, h, cut(h, p));
    expect(withSuffix.message).toContain(join(folderOf(h, withSuffix.sessionId!), 'prompts', 'prompt_0.txt'));
    const k = fixture(99_977, { hangul: true });
    expect(k.length).toBeLessThan(OFFLOAD_MIN_BYTES / 2); // counted in UTF-16 units it would be far under the boundary
    const hangul = await run(k, h, cut(h, k));
    expect(hangul.message).toContain(join(folderOf(h, hangul.sessionId!), 'prompts', 'prompt_0.txt'));
    // grok 1.0.50 kept a leading U+FEFF and cut this at 99,979 bytes; 1.0.52 drops it and does not (both measured). The
    // count is the untrimmed one either way, so it never says less than grok did — JavaScript's trim() would say 99,976.
    const bom = fixture(99_976, { lead: String.fromCharCode(0xfeff) });
    const r = await run(bom, h, cut(h, bom));
    expect(r.message).toContain(join(folderOf(h, r.sessionId!), 'prompts', 'prompt_0.txt'));
    expect(r.message).toMatch(POINTED); // the line kept the U+FEFF too (1.0.50): it is left out of both sides
    // On 1.0.52 the same prompt is recorded whole, without its U+FEFF, and no file is written: nothing is said.
    const quiet = await run(bom, h, (sid) => turn(folderOf(h, sid), 0, { file: false, note: null, prompt: bom.slice(1), whole: true }));
    expect(quiet.message ?? '').not.toMatch(SILENT);
  });

  it('what grok recorded for this run\'s turn decides the sentence', async () => {
    const h = home();
    const p = promptNo(1);
    const lost = (await run(p, h, cut(h, p, NOT_SAVED))).message ?? '';
    expect(lost).toMatch(/가운데/);
    expect(lost).toMatch(STRONG);
    const pointed = (await run(p, h, cut(h, p))).message ?? '';
    expect(pointed).toMatch(POINTED);
    expect(pointed).not.toMatch(STRONG);
    // This run's turn and file, its note in words this wrapper does not know: the file, and nothing about the model.
    const unknown = (await run(p, h, cut(h, p, 'a note in other words'))).message ?? '';
    expect(unknown).toMatch(ATTRIBUTED);
    expect(unknown).not.toMatch(CLAIMS);
  });

  // Grok's round-2 finding: query and note are one history line. A prompt can quote either note itself — only what
  // follows the query, in the query's own part, is grok's.
  it('reads the note grok appended after the query, not a marker quoted inside it or in another part', async () => {
    const h = home();
    const quoting = fixture(100_500, { head: `quoting ${NOT_SAVED}\n` });
    const r = await run(quoting, h, cut(h, quoting));
    expect(r.message).toMatch(POINTED);
    expect(r.message).not.toMatch(STRONG);
    const reworded = await run(quoting, h, cut(h, quoting, 'other words'));
    expect(reworded.message).toMatch(ATTRIBUTED);
    expect(reworded.message).not.toMatch(CLAIMS);
    // No closing tag: nothing on the line is known to follow the query — the file, and nothing about the model, whether
    // the mark follows a space or starts a line (review round 10: a note is read where it starts a line).
    const p = promptNo(2);
    for (const before of [' ', '\n']) {
      const unclosed = await run(p, h, (sid) => {
        const folder = folderOf(h, sid);
        saveFile(folder, 0, p);
        writeFileSync(join(folder, 'chat_history.jsonl'), historyLine(0, [`<user_query>\n${recorded(p)}${before}${NOT_SAVED}`]));
      });
      expect(unclosed.message, JSON.stringify(before)).toMatch(ATTRIBUTED);
      expect(unclosed.message, JSON.stringify(before)).not.toMatch(CLAIMS);
    }
    // After the query only grok writes; were it ever to write both notes, the one it wrote last is the answer — the last
    // of all, not the last of each kind (review round 11).
    expect((await run(p, h, cut(h, p, `${NOT_SAVED}\n\n${offloadedNote('p')}`))).message).toMatch(POINTED);
    expect((await run(p, h, cut(h, p, `${offloadedNote('p')}\n\n${NOT_SAVED}`))).message).toMatch(STRONG);
    expect((await run(p, h, cut(h, p, `${offloadedNote('p')}\n\n${NOT_SAVED}\n\n${offloadedNote('p')}`))).message)
      .toMatch(POINTED);
    // A second text part that quotes a closing tag and the not-saved note is not grok's note to this query.
    const parts = await run(p, h, (sid) => {
      const folder = folderOf(h, sid);
      saveFile(folder, 0, p);
      writeFileSync(join(folder, 'chat_history.jsonl'), historyLine(0, [
        `<user_query>\n${recorded(p)}\n</user_query>\n\n${offloadedNote('p')}`, `</user_query>\n\n${NOT_SAVED}`]));
    });
    expect(parts.message).toMatch(POINTED);
    expect(parts.message).not.toMatch(STRONG);
  });

  // Review round 1 (MEASURED on grok 1.0.50 the same day: a second resume of one session ran to completion and recorded
  // its turn while the first was still waiting for the model): the session another run shares is no evidence about
  // this one. Review round 2: nor is a prompt that only begins alike.
  it('names this run\'s file in a session another run is writing to at the same time', async () => {
    const h = home();
    const folder = folderOf(h, 'continued-session');
    const mine = promptNo(3);
    const theirs = promptNo(4);
    const shared = await run(mine, h, () => {
      turn(folder, 1, { file: true, note: NOT_SAVED, prompt: mine }); // this run, cut, middle lost
      turn(folder, 2, { file: true, note: offloadedNote('p'), prompt: theirs }); // the other run's later turn
    }, { continueSession: true });
    expect(shared.message).toContain('prompt_1.txt');
    expect(shared.message).not.toContain('prompt_2.txt');
    expect(shared.message).toMatch(STRONG);
    for (const n of [1, 2]) setTime(join(folder, 'prompts', `prompt_${n}.txt`), -30_000); // seconds apart, as real runs are
    // Two prompts with the same long preamble (an orchestrator's template).
    const preamble = `You are a coding worker for this repository. ${'Follow the house rules and keep the diff small. '.repeat(40)}\n`;
    const taskA = fixture(100_500, { head: `${preamble}Task A: migrate the ledger module.\n` });
    const taskB = fixture(100_500, { head: `${preamble}Task B: rename the billing flags.\n` });
    const templated = await run(taskA, h, () => {
      turn(folder, 3, { file: true, note: offloadedNote('p'), prompt: taskA });
      turn(folder, 4, { file: true, note: NOT_SAVED, prompt: taskB });
    }, { continueSession: true });
    expect(templated.message).toContain('prompt_3.txt');
    expect(templated.message).not.toContain('prompt_4.txt');
    expect(templated.message).toMatch(POINTED);
    expect(templated.message).not.toMatch(STRONG);
  });

  // Found while fixing review round 2: every prompt ends in the wrapper's suffix, and grok records a cut query as its
  // beginning, a mark and its end — so a recorded query can look like another prompt. The prompt file holds the whole request.
  it('tells apart prompts that differ only where grok cut them, and a shorter prompt that begins alike', async () => {
    const h = home();
    const sid = 'a59-shared-session';
    const folder = folderOf(h, sid);
    turn(folder, 0, { file: false, note: null, prompt: 'A59L000001|seed', whole: true });
    const base = promptNo(32);
    const at = Math.floor(sent(base).length * 0.95);
    const mine = `${base.slice(0, at)}M${base.slice(at + 1)}`;
    const theirs = `${base.slice(0, at)}T${base.slice(at + 1)}`;
    expect(recorded(mine)).toBe(recorded(theirs)); // grok's history cannot tell them apart
    // This run wrote its file and timed out before its turn was recorded; the other run recorded its own.
    const differ = await run(mine, h, () => {
      saveFile(folder, 1, mine);
      turn(folder, 2, { file: true, note: NOT_SAVED, prompt: theirs });
    }, { resumeSessionId: sid }, TIMED_OUT);
    expect(differ.message).toContain('prompt_1.txt');
    expect(differ.message).not.toContain('prompt_2.txt');
    expect(differ.message).toMatch(ATTRIBUTED);
    expect(differ.message).not.toMatch(CLAIMS);
    // A shorter prompt with the same lines, recorded whole by another run, says nothing about this one.
    const shorter = fixture(99_976, { lead: ' ' }); // under grok's boundary once trimmed
    const own = promptNo(33);
    const prefix = await run(own, h, () => {
      turn(folder, 3, { file: false, note: null, prompt: shorter, whole: true });
      saveFile(folder, 4, own);
    }, { resumeSessionId: sid }, TIMED_OUT);
    expect(prefix.message).toContain('prompt_4.txt');
    expect(prefix.message).toMatch(ATTRIBUTED);
    // Other runs' files written during this run, and nothing of this run's: nothing is said — whether the file holds a
    // prompt a little longer or one longer than this prompt's file can be.
    const other = await run(promptNo(34), h, () => {
      saveFile(folder, 5, promptNo(35));
      saveFile(folder, 6, fixture(200_000)); // longer than this prompt's file can be, room for a later layout included
    }, { resumeSessionId: sid }, TIMED_OUT);
    expect(other.message ?? '').not.toMatch(SILENT);
  });

  // Review round 3: files written microseconds after the spawn can be dated before it (file times trailed the process
  // clock by up to 3.45 ms), so the times are set — grok writes its file far later than that.
  it('the same prompt sent by two runs at once ties no file to this run', async () => {
    const h = home();
    const folder = folderOf(h, 'continued-session');
    const p = promptNo(5);
    const r = await run(p, h, () => {
      turn(folder, 1, { file: true, note: offloadedNote('p'), prompt: p });
      turn(folder, 2, { file: true, note: NOT_SAVED, prompt: p });
      setTime(join(folder, 'prompts', 'prompt_1.txt'), 500);
      setTime(join(folder, 'prompts', 'prompt_2.txt'), 600);
    }, { continueSession: true });
    expect(r.message).toMatch(HEDGED);
    expect(r.message).not.toMatch(CLAIMS);
    expect(r.message).not.toMatch(ATTRIBUTED);
    expect(r.message).toContain('prompt_1.txt');
    expect(r.message).toContain('prompt_2.txt');
  });

  // MEASURED on 1.0.50 (while fixing review round 2): a continue that sent the prompt of the resume just before it found
  // the resume's file 1.4–1.5 s before its own — within FAT's 2 s. Where file times are finer than whole seconds, a file
  // dated before the spawn is not this run's; where they are whole seconds, the two cannot be told apart.
  it('the same prompt sent again right after an earlier run names this run\'s file where times are finer than seconds', async () => {
    const at = (path: string, ms: number) => utimesSync(path, new Date(ms), new Date(ms));
    const p = promptNo(39);
    const h = home();
    const folder = folderOf(h, 'continued-session');
    turn(folder, 1, { file: true, note: offloadedNote('p'), prompt: p });
    // The earlier run's file is dated before this run starts, and this run's from the moment grok runs: a slow start
    // cannot put this run's file before the spawn (review round 7).
    const start = Date.now();
    const earlier = start - 700 - ((start - 700) % 1_000 === 0 ? 1 : 0); // finer than seconds, under 2 s before spawn
    at(join(folder, 'prompts', 'prompt_1.txt'), earlier);
    const fine = await run(p, h, () => {
      turn(folder, 2, { file: true, note: NOT_SAVED, prompt: p });
      at(join(folder, 'prompts', 'prompt_2.txt'), Date.now() + 300);
    }, { continueSession: true });
    expect(fine.message).toContain('prompt_2.txt');
    expect(fine.message).not.toContain('prompt_1.txt');
    expect(fine.message).toMatch(STRONG);
    const h2 = home();
    const folder2 = folderOf(h2, 'continued-session');
    turn(folder2, 1, { file: true, note: offloadedNote('p'), prompt: p });
    at(join(folder2, 'prompts', 'prompt_1.txt'), Math.floor(Date.now() / 1_000) * 1_000);
    const coarse = await run(p, h2, () => {
      turn(folder2, 2, { file: true, note: NOT_SAVED, prompt: p });
      at(join(folder2, 'prompts', 'prompt_2.txt'), Math.floor(Date.now() / 1_000) * 1_000 + 1_000);
    }, { continueSession: true });
    expect(coarse.message).toMatch(HEDGED);
    expect(coarse.message).toContain('prompt_1.txt');
    expect(coarse.message).toContain('prompt_2.txt');
    expect(coarse.message).not.toMatch(CLAIMS);
  });

  // Review round 3 (MEASURED on 1.0.50 the same day): grok keeps a CRLF in the file and in the history, and trims only the
  // ends. Removing more on this side let a prompt that differs only in its spacing pass for this one.
  it('compares the prompt as grok keeps it: CRLF kept, a U+0085 it trimmed, a lone surrogate as U+FFFD', async () => {
    const h = home();
    const folder = folderOf(h, 'continued-session');
    const crlf = promptNo(6).split('\n').join('\r\n');
    const r1 = await run(crlf, h, () => turn(folder, 1, { file: true, note: NOT_SAVED, prompt: crlf }), { continueSession: true });
    expect(r1.message).toContain('prompt_1.txt');
    expect(r1.message).toMatch(STRONG);
    setTime(join(folder, 'prompts', 'prompt_1.txt'), -30_000);
    // The same prompt with LF line ends is another prompt: its file is not this run's.
    const lf = await run(crlf, h, () => turn(folder, 4, { file: true, note: NOT_SAVED, prompt: promptNo(6) }), { continueSession: true });
    expect(lf.message ?? '').not.toContain('prompt_4.txt');
    expect(lf.message ?? '').not.toMatch(CLAIMS);
    setTime(join(folder, 'prompts', 'prompt_4.txt'), -30_000);
    const nel = fixture(100_500, { lead: String.fromCharCode(0x85) });
    const r2 = await run(nel, h, () => turn(folder, 2, { file: true, note: NOT_SAVED, prompt: nel.slice(1) }), { continueSession: true });
    expect(r2.message).toContain('prompt_2.txt');
    expect(r2.message).toMatch(STRONG);
    setTime(join(folder, 'prompts', 'prompt_2.txt'), -30_000);
    const base = promptNo(36);
    const lone = `${base.slice(0, 500)}${String.fromCharCode(0xd800)}${base.slice(501)}`;
    const asGot = `${base.slice(0, 500)}${String.fromCharCode(0xfffd)}${base.slice(501)}`;
    const r3 = await run(lone, h, () => turn(folder, 3, { file: true, note: NOT_SAVED, prompt: asGot }), { continueSession: true });
    expect(r3.message).toContain('prompt_3.txt');
    expect(r3.message).toMatch(STRONG);
    setTime(join(folder, 'prompts', 'prompt_3.txt'), -30_000);
    // A leading U+FEFF: grok 1.0.50 kept it in the file and the line, 1.0.52 drops it from both (measured).
    const bom = fixture(100_500, { lead: String.fromCharCode(0xfeff) });
    const kept50 = await run(bom, h, () => turn(folder, 5, { file: true, note: NOT_SAVED, prompt: bom }), { continueSession: true });
    expect(kept50.message).toContain('prompt_5.txt');
    expect(kept50.message).toMatch(STRONG);
    setTime(join(folder, 'prompts', 'prompt_5.txt'), -30_000);
    const dropped52 = await run(bom, h, () => turn(folder, 6, { file: true, note: NOT_SAVED, prompt: bom.slice(1) }), { continueSession: true });
    expect(dropped52.message).toContain('prompt_6.txt');
    expect(dropped52.message).toMatch(STRONG);
  });

  // A U+FEFF among leading blanks (review round 5). What grok kept, measured: 1.0.52 drops a U+FEFF at the start, trims,
  // then drops one more; 1.0.50 keeps every U+FEFF and trims only what comes before the first. The file and the line
  // hold the same. Each case gets its own home: one folder made every run re-read the ones before (review round 6).
  it('compares across the leading run of blanks and U+FEFF that grok versions leave differently', async () => {
    const c = String.fromCharCode;
    const body = promptNo(37);
    const spaces = ' '.repeat(70 * 1024); // more than a file's room: what may be kept is bounded by what grok was handed
    const cases: Array<[string, string, string]> = [
      [`${c(0xfeff)}${c(10)}`, '', `${c(0xfeff)}${c(10)}`], // 1.0.52: nothing; 1.0.50: both kept
      [`${c(10)}${c(0xfeff)}${c(10)}`, c(10), `${c(0xfeff)}${c(10)}`], // 1.0.52 keeps an LF; 1.0.50 the U+FEFF and an LF
      [`${c(0x20)}${c(0xfeff)}${c(0x20)}`, c(0x20), `${c(0xfeff)}${c(0x20)}`], // 1.0.52 keeps a space
      [`${c(0xfeff)}${c(0xfeff)}${c(0xfeff)}`, c(0xfeff), `${c(0xfeff)}${c(0xfeff)}${c(0xfeff)}`], // 1.0.52 keeps one U+FEFF
      [`${c(0xfeff)}${c(0x85)}`, '', `${c(0xfeff)}${c(0x85)}`], // a U+0085 after the U+FEFF: White_Space, not JavaScript's
      [`${c(0xfeff)}${spaces}`, '', `${c(0xfeff)}${spaces}`], // 1.0.50 keeps the U+FEFF and 70 KiB of spaces
    ];
    for (const [lead, left52, left50] of cases) {
      for (const left of [left52, left50]) {
        const h = home();
        const folder = folderOf(h, 'continued-session');
        const text = left + sent(body);
        const r = await run(lead + body, h, () => {
          mkdirSync(join(folder, 'prompts'), { recursive: true });
          writeFileSync(join(folder, 'prompts', 'prompt_1.txt'), `<user_query>\n${text}\n</user_query>`);
          const cutText = text.slice(0, Math.floor(text.length * 0.94)) + OMISSION + text.slice(text.length - Math.floor(text.length * 0.04));
          appendFileSync(join(folder, 'chat_history.jsonl'), historyLine(1, [`<user_query>\n${cutText}\n</user_query>\n\n${NOT_SAVED}`]));
        }, { continueSession: true });
        expect(r.message).toContain('prompt_1.txt');
        expect(r.message).toMatch(STRONG);
      }
    }
  }, 20_000);

  // Review round 2: a turn of this run recorded whole means grok did not cut it — another run's fresh file says nothing
  // about this one.
  it('says nothing when this run\'s own turn shows no cut, whatever another run left', async () => {
    const h = home();
    const folder = folderOf(h, 'continued-session');
    const mine = fixture(99_976, { lead: ' ' }); // over the boundary only by a space grok trims
    const r = await run(mine, h, () => {
      turn(folder, 1, { file: false, note: null, prompt: mine, whole: true });
      turn(folder, 2, { file: true, note: NOT_SAVED, prompt: promptNo(7) });
    }, { continueSession: true });
    expect(r.message ?? '').not.toMatch(SILENT);
    // Nor a file this wrapper cannot read for the prompt (a layout a later grok may use).
    const r2 = await run(mine, h, () => {
      turn(folder, 3, { file: false, note: null, prompt: mine, whole: true });
      writeFileSync(join(folder, 'prompts', 'prompt_4.txt'), sent(promptNo(8)));
    }, { continueSession: true });
    expect(r2.message ?? '').not.toMatch(SILENT);
  });

  it('in the minted folder a not-saved note means the middle was lost even with no file left', async () => {
    const h = home();
    const p = promptNo(8);
    const r = await run(p, h, (sid) => turn(folderOf(h, sid), 0, { file: false, note: NOT_SAVED, prompt: p }));
    expect(r.message).toMatch(STRONG);
    expect(r.message).not.toMatch(/prompt_/);
    // Outside the minted folder a recorded query can look like another prompt's: only "may have been cut", no file.
    const folder = folderOf(h, 'continued-session');
    const c = await run(p, h, () => turn(folder, 1, { file: false, note: NOT_SAVED, prompt: p }), { continueSession: true });
    expect(c.message).toMatch(HEDGED);
    expect(c.message).not.toMatch(/prompt_/);
    expect(c.message).not.toMatch(CLAIMS);
  });

  it('a new session\'s file counts whatever its time says — a FAT volume keeps times in 2-second steps', async () => {
    // No history to go by either: the listing taken before the spawn (empty, under the minted id) is enough.
    const h = home();
    const p = promptNo(9);
    const r = await run(p, h, (sid) => {
      saveFile(folderOf(h, sid), 0, p);
      setTime(join(folderOf(h, sid), 'prompts', 'prompt_0.txt'), -3_000);
    });
    expect(r.message).toContain('prompt_0.txt');
    expect(r.message).toMatch(ATTRIBUTED);
    expect(r.message).not.toMatch(CLAIMS);
  });

  it('a resumed turn names its own file, never one an earlier turn left', async () => {
    const h = home();
    const sid = 'a59-resumed-session';
    const folder = folderOf(h, sid);
    turn(folder, 0, { file: false, note: null, prompt: 'A59L000001|seed', whole: true });
    turn(folder, 1, { file: true, note: NOT_SAVED, prompt: promptNo(10) }); // an earlier long turn, middle lost
    setTime(join(folder, 'prompts', 'prompt_1.txt'), 60_000); // a skewed clock: its time says nothing
    // grok trims the leading space, lands under the boundary and writes no file for this turn.
    const quietPrompt = fixture(99_976, { lead: ' ' });
    const quiet = await run(quietPrompt, h, () => turn(folder, 2, { file: false, note: null, prompt: quietPrompt, whole: true }),
      { resumeSessionId: sid });
    expect(quiet.message ?? '').not.toMatch(SILENT);
    const own = promptNo(11);
    const r = await run(own, h, () => turn(folder, 3, { file: true, note: offloadedNote('p'), prompt: own }), { resumeSessionId: sid });
    expect(r.message).toContain('prompt_3.txt');
    expect(r.message).toMatch(POINTED);
    // A rewound session reuses a turn's number: the listing held prompt_3, and this run — the same prompt again — wrote
    // it again. Same size, so only its time tells; of the two lines of this prompt at that number, the latest is this run's.
    const rewound = await run(own, h, () => {
      saveFile(folder, 3, own);
      setTime(join(folder, 'prompts', 'prompt_3.txt'), 30_000);
      turn(folder, 3, { file: false, note: NOT_SAVED, prompt: own });
    }, { resumeSessionId: sid });
    expect(rewound.message).toContain('prompt_3.txt');
    expect(rewound.message).toMatch(STRONG);
    // A run that wrote its file and timed out before its turn was recorded: the file, and nothing about the model.
    const late = promptNo(13);
    const unrecorded = await run(late, h, () => saveFile(folder, 4, late), { resumeSessionId: sid }, TIMED_OUT);
    expect(unrecorded.message).toContain('prompt_4.txt');
    expect(unrecorded.message).not.toContain('prompt_1.txt');
    expect(unrecorded.message).toMatch(ATTRIBUTED);
    expect(unrecorded.message).not.toMatch(CLAIMS);
    // Rewound again, and timed out before the turn was recorded: the lines that number holds are another prompt's.
    const last = promptNo(38);
    const rewoundAgain = await run(last, h, () => saveFile(folder, 3, last), { resumeSessionId: sid }, TIMED_OUT);
    expect(rewoundAgain.message).toContain('prompt_3.txt');
    expect(rewoundAgain.message).toMatch(ATTRIBUTED);
    expect(rewoundAgain.message).not.toMatch(CLAIMS);
  });

  it('a run that reports another session than the one minted for it is looked for there', async () => {
    const h = home();
    const other = folderOf(h, 'reported-instead');
    turn(other, 0, { file: true, note: NOT_SAVED, prompt: promptNo(14) });
    setTime(join(other, 'prompts', 'prompt_0.txt'), -60_000);
    const p = promptNo(15);
    expect((await run(p, h, () => {}, {}, {}, 'reported-instead')).message ?? '').not.toMatch(SILENT);
    const there = await run(p, h, () => turn(other, 1, { file: true, note: offloadedNote('p'), prompt: p }), {}, {}, 'reported-instead');
    expect(there.message).toContain(join(other, 'prompts', 'prompt_1.txt'));
    expect(there.message).toMatch(POINTED);
    // Both folders hold a turn of this run: the folder of the id grok was given is looked at first.
    const q = promptNo(16);
    let mintedId = '';
    const both = await run(q, h, (minted) => {
      mintedId = minted;
      turn(folderOf(h, minted), 0, { file: true, note: NOT_SAVED, prompt: q });
      turn(other, 2, { file: true, note: offloadedNote('p'), prompt: q });
    }, {}, {}, 'reported-instead');
    expect(both.message).toContain(join(folderOf(h, mintedId), 'prompts', 'prompt_0.txt'));
    expect(both.message).not.toContain(join(other, 'prompts'));
    expect(both.message).toMatch(STRONG);
    // The listing taken under the minted id says nothing about the reported folder: an old file of this prompt there
    // (its turn 0, a minute old) is named, not taken for this run's.
    const h2 = home();
    const other2 = folderOf(h2, 'reported-instead');
    const r = promptNo(61);
    turn(other2, 0, { file: true, note: offloadedNote('p'), prompt: r });
    setTime(join(other2, 'prompts', 'prompt_0.txt'), -60_000);
    const old = await run(r, h2, () => {}, {}, {}, 'reported-instead');
    expect(old.message).toContain(join(other2, 'prompts', 'prompt_0.txt'));
    expect(old.message).toMatch(HEDGED);
    expect(old.message).not.toMatch(CLAIMS);
  });

  // A rewound session writes a number again: of two lines of this prompt with that number, the latest is this run's.
  it('a continued turn that reuses a number is read from its own, latest line', async () => {
    const h = home();
    const folder = folderOf(h, 'continued-session');
    const p = promptNo(60);
    turn(folder, 2, { file: true, note: offloadedNote('p'), prompt: p }); // an earlier turn of the same prompt
    setTime(join(folder, 'prompts', 'prompt_2.txt'), -30_000);
    const r = await run(p, h, () => {
      saveFile(folder, 2, p); // this run, number 2 again
      appendFileSync(join(folder, 'chat_history.jsonl'), historyLine(2, [`<user_query>\n${recorded(p)}\n</user_query>\n\n${NOT_SAVED}`]));
    }, { continueSession: true });
    expect(r.message).toContain('prompt_2.txt');
    expect(r.message).toMatch(STRONG);
  });

  // Review round 2: a session id is joined into a path, so one that is not a single segment names no folder.
  it('a session id that is not one path segment names no folder', async () => {
    const h = home();
    mkdirSync(join(h, 'sessions', ENC), { recursive: true });
    const p = promptNo(17);
    const r = await run(p, h, () => turn(join(h, 'sessions', 'shadow'), 0, { file: true, note: NOT_SAVED, prompt: p }),
      { continueSession: true }, {}, '../shadow');
    expect(r.message ?? '').not.toMatch(SILENT);
    // `.` and `..` are one segment each, but name the encoded cwd's folder and the sessions folder (review round 12).
    for (const [id, where] of [['.', [ENC]], ['..', []]] as const) {
      const h2 = home();
      mkdirSync(join(h2, 'sessions', ENC), { recursive: true });
      const dotted = await run(p, h2, () => turn(join(h2, 'sessions', ...where), 0, { file: true, note: NOT_SAVED, prompt: p }),
        { continueSession: true }, {}, id);
      expect(dotted.message ?? '', id).not.toMatch(SILENT);
    }
  });

  // Review round 12: a run lasts as long as grok works, so the window runs from the spawn to the check — a file grok
  // writes 30 s into a minute-long continue is this run's; a file listed before the spawn and rewritten during it at the
  // same time (a coarse clock) is told by its size; and a user line whose content is one string is read as parts are.
  it('the time window spans the run, a same-time rewrite shows in its size, and string content is read', async () => {
    const h = home();
    const folder = folderOf(h, 'continued-session');
    const p = promptNo(101);
    const t0 = Date.now();
    const realNow = Date.now.bind(Date);
    let offset = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
    try {
      const long = await run(p, h, () => {
        turn(folder, 1, { file: true, note: offloadedNote('p'), prompt: p });
        const at = new Date(t0 + 30_007);
        utimesSync(join(folder, 'prompts', 'prompt_1.txt'), at, at);
        offset = 60_000;
      }, { continueSession: true });
      expect(long.message).toContain('prompt_1.txt');
      expect(long.message).toMatch(ATTRIBUTED);
      expect(long.message).toMatch(POINTED);
    } finally {
      clock.mockRestore();
    }
    // A resume: another run's prompt_1.txt listed before the spawn, then this run's written over it, its time kept.
    const h2 = home();
    const sid = 'a59-same-time';
    const folder2 = folderOf(h2, sid);
    turn(folder2, 0, { file: false, note: null, prompt: 'A59L000001|seed', whole: true });
    saveFile(folder2, 1, promptNo(102));
    const path = join(folder2, 'prompts', 'prompt_1.txt');
    fatTime(path);
    const { mtime } = statSync(path);
    const p2 = promptNo(103);
    const rewritten = await run(p2, h2, () => {
      turn(folder2, 1, { file: true, note: offloadedNote('p'), prompt: p2 });
      utimesSync(path, mtime, mtime);
    }, { resumeSessionId: sid });
    expect(rewritten.message).toContain('prompt_1.txt');
    expect(rewritten.message).toMatch(ATTRIBUTED);
    // A new session whose user line holds one string: the query and grok's not-saved note.
    const h3 = home();
    const p3 = promptNo(104);
    const plain = await run(p3, h3, (sid3) => {
      mkdirSync(folderOf(h3, sid3), { recursive: true });
      appendFileSync(join(folderOf(h3, sid3), 'chat_history.jsonl'), `${JSON.stringify({ type: 'user', prompt_index: 0,
        content: `<user_query>\n${recorded(p3)}\n</user_query>\n\n${NOT_SAVED}` })}\n`);
    });
    expect(plain.message).toMatch(STRONG);
  });

  it('with no readable history the file that holds this prompt is still named, without what the model was told', async (ctx) => {
    const h = home();
    // A history that is a folder (any OS): a continue, so no listing either — the time decides, with FAT's 2 s.
    const folder = folderOf(h, 'continued-session');
    mkdirSync(join(folder, 'chat_history.jsonl'), { recursive: true });
    const dirPrompt = promptNo(18);
    const dir = await run(dirPrompt, h, () => {
      saveFile(folder, 3, dirPrompt);
      fatTime(join(folder, 'prompts', 'prompt_3.txt'));
    }, { continueSession: true });
    expect(dir.message).toContain('prompt_3.txt');
    expect(dir.message).toMatch(ATTRIBUTED);
    expect(dir.message).not.toMatch(CLAIMS);
    // A file not laid out as grok 1.0.50 lays it out cannot be read for the prompt: named, not called this run's.
    const h2 = home();
    const folder2 = folderOf(h2, 'continued-session');
    const raw = promptNo(19);
    const bare = await run(raw, h2, () => {
      mkdirSync(join(folder2, 'prompts'), { recursive: true });
      writeFileSync(join(folder2, 'prompts', 'prompt_1.txt'), sent(raw));
    }, { continueSession: true });
    expect(bare.message).toContain('prompt_1.txt');
    expect(bare.message).toMatch(HEDGED);
    expect(bare.message).not.toMatch(ATTRIBUTED);
    // In the minted folder turn 0's file is this run's, whatever its layout.
    const minted = await run(raw, h2, (sid) => {
      mkdirSync(join(folderOf(h2, sid), 'prompts'), { recursive: true });
      writeFileSync(join(folderOf(h2, sid), 'prompts', 'prompt_0.txt'), sent(raw));
    });
    expect(minted.message).toContain('prompt_0.txt');
    expect(minted.message).toMatch(ATTRIBUTED);
    expect(minted.message).not.toMatch(CLAIMS);
    // A history that is a link is not read either (win32 has no O_NOFOLLOW; lstat refuses it first).
    const p = promptNo(20);
    const decoy = join(h, 'decoy.jsonl');
    writeFileSync(decoy, historyLine(0, [`<user_query>\n${recorded(p)}\n</user_query>\n\n${NOT_SAVED}`]));
    let linked = true;
    const link = await run(p, h, (sid) => {
      const f = folderOf(h, sid);
      saveFile(f, 0, p);
      try { symlinkSync(decoy, join(f, 'chat_history.jsonl')); } catch { linked = false; }
    });
    if (!linked) ctx.skip(); // win32 without the privilege
    expect(link.message).toMatch(ATTRIBUTED);
    expect(link.message).not.toMatch(CLAIMS);
  });

  // Review round 1: a turn that cannot be found in the record must not end in silence on the paths without a listing.
  it('a turn further back than the tail it reads, or a reshaped record, still names the file', async () => {
    const h = home();
    const folder = folderOf(h, 'continued-session');
    const p = promptNo(21);
    const far = await run(p, h, () => {
      turn(folder, 1, { file: true, note: NOT_SAVED, prompt: p });
      appendFileSync(join(folder, 'chat_history.jsonl'),
        `${JSON.stringify({ type: 'assistant', content: 'y'.repeat(90_000), model_id: 'grok-4.6' })}\n`.repeat(100));
    }, { continueSession: true });
    expect(far.message).toContain('prompt_1.txt');
    expect(far.message).toMatch(ATTRIBUTED);
    expect(far.message).not.toMatch(CLAIMS);
    const h2 = home();
    const folder2 = folderOf(h2, 'continued-session');
    const reshaped = await run(p, h2, () => {
      saveFile(folder2, 1, p);
      appendFileSync(join(folder2, 'chat_history.jsonl'), `${JSON.stringify({
        type: 'user', content: [{ type: 'text', text: `<user_query>\n${recorded(p)}\n</user_query>\n\n${NOT_SAVED}` }], promptIndex: 1,
      })}\n`);
    }, { continueSession: true });
    expect(reshaped.message).toContain('prompt_1.txt');
    expect(reshaped.message).toMatch(ATTRIBUTED);
    expect(reshaped.message).not.toMatch(CLAIMS);
  });

  // The cut line of this prompt is still there, so "may have been cut" is said — without a file.
  it('a prompt_index that is not a whole, non-negative number names no file', async () => {
    const h = home();
    const folder = folderOf(h, 'continued-session');
    const p = promptNo(22);
    for (const [index, name] of [[1e400, 'prompt_Infinity.txt'], [-1, 'prompt_-1.txt'], [1.5, 'prompt_1.5.txt']] as const) {
      const r = await run(p, h, () => {
        mkdirSync(join(folder, 'prompts'), { recursive: true });
        writeFileSync(join(folder, 'prompts', name), `<user_query>\n${kept(p)}\n</user_query>`);
        appendFileSync(join(folder, 'chat_history.jsonl'),
          `{"type":"user","content":[{"type":"text","text":${JSON.stringify(`<user_query>\n${recorded(p)}\n</user_query>\n\n${NOT_SAVED}`)}}],"prompt_index":${index === 1e400 ? '1e400' : index}}\n`);
      }, { continueSession: true });
      expect(r.message ?? '', String(index)).not.toMatch(/prompt_/);
      expect(r.message ?? '', String(index)).not.toMatch(CLAIMS);
    }
  });

  it('a continued turn counts its own file — not an old one, and not one lost to a coarse or skewed clock', async () => {
    const h = home();
    const folder = folderOf(h, 'continued-session');
    turn(folder, 0, { file: true, note: NOT_SAVED, prompt: promptNo(23) });
    setTime(join(folder, 'prompts', 'prompt_0.txt'), 60_000); // another run's, skewed into the future
    const quietPrompt = fixture(99_976, { lead: ' ' });
    const quiet = await run(quietPrompt, h, () => turn(folder, 1, { file: false, note: null, prompt: quietPrompt, whole: true }),
      { continueSession: true });
    expect(quiet.message ?? '').not.toMatch(SILENT);
    const ownPrompt = promptNo(24);
    // A file system stamps with a coarser clock than the process reads: dated 50 ms before the spawn, still this run's.
    const own = await run(ownPrompt, h, () => {
      turn(folder, 2, { file: true, note: offloadedNote('p'), prompt: ownPrompt });
      setTime(join(folder, 'prompts', 'prompt_2.txt'), -50);
    }, { continueSession: true });
    expect(own.message).toContain('prompt_2.txt');
    expect(own.message).toMatch(POINTED);
    setTime(join(folder, 'prompts', 'prompt_2.txt'), -30_000); // real runs are seconds apart; these are not
    const backPrompt = promptNo(25);
    const backDated = await run(backPrompt, h, () => {
      turn(folder, 3, { file: true, note: NOT_SAVED, prompt: backPrompt });
      fatTime(join(folder, 'prompts', 'prompt_3.txt')); // FAT keeps 2-second times: possibly before the spawn
    }, { continueSession: true });
    expect(backDated.message).toContain('prompt_3.txt');
    expect(backDated.message).toMatch(STRONG);
    setTime(join(folder, 'prompts', 'prompt_3.txt'), -30_000);
    // The same with a time finer than seconds, 1.5 s before the spawn: an earlier run's file — named, not tied to this run.
    const earlyPrompt = promptNo(40);
    turn(folder, 6, { file: true, note: offloadedNote('p'), prompt: earlyPrompt });
    // 1.3–2.3 s before the spawn, never on a whole second (review round 4: -1,500 ms from a time ending in 500 was one).
    const early6 = new Date(Math.floor(Date.now() / 1_000) * 1_000 - 1_300);
    utimesSync(join(folder, 'prompts', 'prompt_6.txt'), early6, early6);
    const early = await run(earlyPrompt, h, () => {
      appendFileSync(join(folder, 'chat_history.jsonl'), historyLine(7, [`<user_query>\n${recorded(earlyPrompt)}\n</user_query>\n\n${NOT_SAVED}`]));
    }, { continueSession: true });
    expect(early.message).toContain('prompt_6.txt');
    expect(early.message).toMatch(HEDGED);
    expect(early.message).not.toMatch(CLAIMS);
    setTime(join(folder, 'prompts', 'prompt_6.txt'), -30_000);
    const upPrompt = promptNo(26);
    const roundedUp = await run(upPrompt, h, () => {
      turn(folder, 4, { file: true, note: NOT_SAVED, prompt: upPrompt });
      setTime(join(folder, 'prompts', 'prompt_4.txt'), 2_500); // FAT may round a time up to the next step
    }, { continueSession: true });
    expect(roundedUp.message).toContain('prompt_4.txt');
    expect(roundedUp.message).toMatch(STRONG);
    setTime(join(folder, 'prompts', 'prompt_4.txt'), -30_000);
    // This run's own file dated far off (a skewed clock): named, but not tied to this run.
    const skewPrompt = promptNo(27);
    const skewed = await run(skewPrompt, h, () => {
      turn(folder, 5, { file: true, note: NOT_SAVED, prompt: skewPrompt });
      setTime(join(folder, 'prompts', 'prompt_5.txt'), 60_000);
    }, { continueSession: true });
    expect(skewed.message).toContain('prompt_5.txt');
    expect(skewed.message).toMatch(HEDGED);
    expect(skewed.message).not.toMatch(CLAIMS);
  });

  it('a resume whose session appears only after the run is found by its file', async () => {
    const h = home();
    const sid = 'a59-late-session';
    const folder = folderOf(h, sid);
    const quietPrompt = fixture(99_976, { lead: ' ' });
    const quiet = await run(quietPrompt, h, () => {
      turn(folder, 1, { file: true, note: NOT_SAVED, prompt: promptNo(28) });
      setTime(join(folder, 'prompts', 'prompt_1.txt'), 60_000);
      turn(folder, 2, { file: false, note: null, prompt: quietPrompt, whole: true });
    }, { resumeSessionId: sid });
    expect(quiet.message ?? '').not.toMatch(SILENT);
    const own = promptNo(29);
    const r = await run(own, h, () => turn(folder, 3, { file: true, note: offloadedNote('p'), prompt: own }), { resumeSessionId: sid });
    expect(r.message).toContain('prompt_3.txt');
  });

  it('says nothing where the model never got the prompt: a start failure, a refusal before the session, an auth error', async () => {
    const h = home();
    const p = promptNo(30);
    const failed = await runDelegate('subscription', { prompt: p, cwd: '/tmp/proj' },
      { ...deps({}), env: { GROK_HOME: h }, spawn: fakeSpawn({ spawnError: true, code: -1, stderr: 'spawn grok ENOENT' }) });
    expect(failed.status).toBe('grok_error');
    expect(failed.message).not.toMatch(SILENT);
    // A53's shape: grok refused before it made the session, so nothing is under sessions/.
    const refused = await run(p, h, () => {}, {}, { code: 1, stdout: '', stderr: 'Error: TOML parse error' });
    expect(refused.status).toBe('grok_error');
    expect(refused.message).not.toMatch(SILENT);
    // Review round 1: grok recorded the turn and the file, then the request was refused — nothing reached the model.
    const authed = await run(p, h, cut(h, p, NOT_SAVED), {},
      { code: 1, stdout: JSON.stringify({ type: 'error', message: 'Invalid or expired credentials' }) });
    expect(authed.status).toBe('auth_error');
    expect(authed.message).not.toMatch(SILENT);
  });

  it('a run that failed after grok cut the prompt says so after its own message', async () => {
    const h = home();
    const p = promptNo(31);
    const r = await run(p, h, cut(h, p, NOT_SAVED), {}, TIMED_OUT);
    expect(r.status).toBe('timeout');
    expect(r.message!.startsWith('Grok Build 작업이')).toBe(true); // the timeout's own text comes first
    expect(r.message).toMatch(STRONG);
  });

  it('an index that cannot name a session folder makes no claim', async () => {
    const h = home();
    const p = promptNo(37);
    const r = await runDelegate('subscription', { prompt: p, cwd: '/tmp/proj' }, {
      ...deps({}),
      env: { GROK_HOME: h },
      sessionsIndex: { listSessionDirs: () => [ENC], sessionDirHasId: () => true },
      spawn: async (args) => {
        turn(folderOf(h, args[args.indexOf('--session-id') + 1]), 0, { file: true, note: NOT_SAVED, prompt: p });
        return { code: 0, stdout: okJson(), stderr: '', timedOut: false };
      },
    });
    expect(r.message ?? '').not.toMatch(SILENT);
  });

  // Review round 3: removing all whitespace before comparing let a prompt that differs only in its spacing pass for this one.
  it('a prompt that differs from this one only in its spacing is another prompt', async () => {
    const h = home();
    const folder = folderOf(h, 'continued-session');
    const mine = fixture(99_976, { lead: ' ' }); // grok trims the space and does not cut it
    const spaced = fixture(99_976).replace('|x', '| x'); // one space more inside: 99,977 bytes, cut
    const r = await run(mine, h, () => {
      turn(folder, 1, { file: false, note: null, prompt: mine, whole: true });
      turn(folder, 2, { file: true, note: NOT_SAVED, prompt: spaced });
    }, { continueSession: true });
    expect(r.message ?? '').not.toMatch(SILENT);
  });

  // Review round 3: a file this wrapper cannot read for the prompt is named, not taken for another prompt's — however long.
  it('a file in a layout this wrapper does not know is named without being called this run\'s, however long', async () => {
    const h = home();
    const folder = folderOf(h, 'continued-session');
    const p = promptNo(41);
    const longer = await run(p, h, () => {
      mkdirSync(join(folder, 'prompts'), { recursive: true });
      writeFileSync(join(folder, 'prompts', 'prompt_1.txt'), `${'#'.repeat(2_000)}\n${kept(p)}`); // a long header first
    }, { continueSession: true });
    expect(longer.message).toContain('prompt_1.txt');
    expect(longer.message).toMatch(HEDGED);
    setTime(join(folder, 'prompts', 'prompt_1.txt'), -30_000);
    const inside = await run(p, h, () => {
      writeFileSync(join(folder, 'prompts', 'prompt_2.txt'), `<user_query>\n[attached: none]\n${kept(p)}\n</user_query>`);
    }, { continueSession: true });
    expect(inside.message).toContain('prompt_2.txt');
    expect(inside.message).toMatch(HEDGED);
    setTime(join(folder, 'prompts', 'prompt_2.txt'), -30_000);
    // grok's frame around a much longer prompt is another prompt's.
    const other = await run(p, h, () => saveFile(folder, 3, fixture(120_000)), { continueSession: true });
    expect(other.message ?? '').not.toMatch(SILENT);
    setTime(join(folder, 'prompts', 'prompt_3.txt'), -30_000);
    // Up to 64 KiB more inside grok's frame is still read for this prompt (named, hedged); more than that is another
    // prompt's: only its ends are read (review rounds 5–6).
    const framedRoom = await run(p, h, () => {
      writeFileSync(join(folder, 'prompts', 'prompt_5.txt'), `<user_query>\n${kept(p)}\n${'w'.repeat(60 * 1024)}\n</user_query>`);
    }, { continueSession: true });
    expect(framedRoom.message).toContain('prompt_5.txt');
    expect(framedRoom.message).toMatch(HEDGED);
    setTime(join(folder, 'prompts', 'prompt_5.txt'), -30_000);
    const framedLong = await run(p, h, () => {
      writeFileSync(join(folder, 'prompts', 'prompt_4.txt'), `<user_query>\n${kept(p)}\n${'w'.repeat(70 * 1024)}\n</user_query>`);
    }, { continueSession: true });
    expect(framedLong.message ?? '').not.toMatch(SILENT);
    setTime(join(folder, 'prompts', 'prompt_4.txt'), -30_000);
    // Outside the minted folder prompt_0.txt is no more this run's than any other number (review round 5).
    const zero = await run(p, h, () => {
      writeFileSync(join(folder, 'prompts', 'prompt_0.txt'), `${'#'.repeat(2_000)}\n${kept(p)}`);
    }, { continueSession: true });
    expect(zero.message).toContain('prompt_0.txt');
    expect(zero.message).toMatch(HEDGED);
    expect(zero.message).not.toMatch(ATTRIBUTED);
  });

  // Review round 3: a concurrent --continue can join the minted session; its turns come after this run's turn 0.
  it('in the minted folder this run is turn 0 — a run that joined the session is not', async () => {
    const h = home();
    const p = promptNo(42);
    const joined = await run(p, h, (sid) => {
      turn(folderOf(h, sid), 0, { file: true, note: offloadedNote('p'), prompt: p });
      turn(folderOf(h, sid), 1, { file: true, note: NOT_SAVED, prompt: promptNo(43) });
    });
    expect(joined.message).toContain('prompt_0.txt');
    expect(joined.message).not.toContain('prompt_1.txt');
    expect(joined.message).toMatch(POINTED);
    // The joined run's file in a layout this wrapper cannot read is not this run's either.
    const unread = await run(p, h, (sid) => {
      turn(folderOf(h, sid), 0, { file: true, note: offloadedNote('p'), prompt: p });
      writeFileSync(join(folderOf(h, sid), 'prompts', 'prompt_1.txt'), sent(promptNo(43)));
    });
    expect(unread.message).toContain('prompt_0.txt');
    expect(unread.message).not.toContain('prompt_1.txt');
    expect(unread.message).toMatch(POINTED);
    // This run's turn 0 kept whole (grok did not cut it), and a joined run's file: nothing is said.
    const whole = fixture(99_976, { lead: ' ' });
    const quiet = await run(whole, h, (sid) => {
      turn(folderOf(h, sid), 0, { file: false, note: null, prompt: whole, whole: true });
      turn(folderOf(h, sid), 1, { file: true, note: NOT_SAVED, prompt: promptNo(44) });
    });
    expect(quiet.message ?? '').not.toMatch(SILENT);
    // A file kept for a prompt grok did not cut (a later grok's habit) says nothing either.
    const keptWhole = await run(whole, h, (sid) => turn(folderOf(h, sid), 0, { file: true, note: null, prompt: whole, whole: true }));
    expect(keptWhole.message ?? '').not.toMatch(SILENT);
  });

  // MEASURED on 1.0.50 (review round 3): two resumes started together both got prompt_index 1, and the later file replaced
  // the earlier one. The earlier run's cut line stays in the record; its file now holds the other prompt.
  it('of two runs that got the same turn number, the one whose file was replaced says only "may have been cut"', async () => {
    const sid = 'a59-same-number';
    const a = promptNo(45);
    const b = fixture(100_545).split('A59L').join('B59L');
    const view = async (prompt: string) => {
      const h = home();
      const folder = folderOf(h, sid);
      turn(folder, 0, { file: false, note: null, prompt: 'A59L000001|seed', whole: true });
      return run(prompt, h, () => {
        turn(folder, 1, { file: true, note: offloadedNote('p'), prompt: a });
        turn(folder, 1, { file: true, note: offloadedNote('p'), prompt: b }); // the later write is prompt_1.txt now
      }, { resumeSessionId: sid });
    };
    const first = await view(a);
    expect(first.message).toMatch(HEDGED);
    expect(first.message).not.toMatch(/prompt_/);
    expect(first.message).not.toMatch(CLAIMS);
    const second = await view(b);
    expect(second.message).toContain('prompt_1.txt');
    expect(second.message).toMatch(POINTED);
    // Two prompts from one template (the same beginning and end, different middles): this run's file was written last,
    // the other run's line recorded last. Its line keeps far more than a mark between the shared ends, so it is not this
    // prompt's, and this run's own note is read.
    const template = (task: string) => fixture(100_500, { head: `${'Shared preamble for every worker. '.repeat(100)}\n${task.repeat(30_000)}\n` });
    const mine = template('m');
    const theirs = template('t');
    const h = home();
    const folder = folderOf(h, sid);
    turn(folder, 0, { file: false, note: null, prompt: 'A59L000001|seed', whole: true });
    const both = await run(mine, h, () => {
      turn(folder, 1, { file: true, note: offloadedNote('p'), prompt: mine });
      turn(folder, 1, { file: false, note: NOT_SAVED, prompt: theirs });
    }, { resumeSessionId: sid });
    expect(both.message).toContain('prompt_1.txt');
    expect(both.message).toMatch(POINTED);
    expect(both.message).not.toMatch(STRONG);
  });

  // Review round 3: with a listing taken before the spawn, times decide nothing — a file-system clock running behind
  // cannot make one of two runs' files look like an earlier run's.
  it('on a resume the listing alone decides what this run wrote', async () => {
    const h = home();
    const sid = 'a59-behind-clock';
    const folder = folderOf(h, sid);
    turn(folder, 0, { file: false, note: null, prompt: 'A59L000001|seed', whole: true });
    const p = promptNo(46);
    const r = await run(p, h, () => {
      turn(folder, 1, { file: true, note: offloadedNote('p'), prompt: p });
      turn(folder, 2, { file: true, note: NOT_SAVED, prompt: p });
      setTime(join(folder, 'prompts', 'prompt_1.txt'), -500);
      setTime(join(folder, 'prompts', 'prompt_2.txt'), 500);
    }, { resumeSessionId: sid });
    expect(r.message).toMatch(HEDGED);
    expect(r.message).toContain('prompt_1.txt');
    expect(r.message).toContain('prompt_2.txt');
  });

  // Review round 3: a file the listing held before the spawn is an earlier attempt's — not this run's, and not named.
  // Review round 4: nor is that attempt's cut line, written before the spawn — a resume reads only the lines written
  // during the run, so one grok refused before its turn says nothing either.
  it('a resume that wrote nothing says nothing about an earlier attempt', async () => {
    const h = home();
    const sid = 'a59-retried';
    const folder = folderOf(h, sid);
    const p = promptNo(47);
    turn(folder, 1, { file: true, note: offloadedNote('p'), prompt: p });
    const timedOut = await run(p, h, () => {}, { resumeSessionId: sid }, TIMED_OUT);
    expect(timedOut.message ?? '').not.toMatch(SILENT);
    const refused = await run(p, h, () => {}, { resumeSessionId: sid }, { code: 1, stdout: '', stderr: 'Error: TOML parse error' });
    expect(refused.status).toBe('grok_error');
    expect(refused.message ?? '').not.toMatch(SILENT);
    // A rewound retry records its cut turn under the attempt's number and leaves no file of its own: the attempt's file,
    // there before the spawn, is not read or named.
    const rewound = await run(p, h, () => {
      appendFileSync(join(folder, 'chat_history.jsonl'), historyLine(1, [`<user_query>\n${recorded(p)}\n</user_query>\n\n${NOT_SAVED}`]));
    }, { resumeSessionId: sid }, TIMED_OUT);
    expect(rewound.message).toMatch(HEDGED);
    expect(rewound.message).not.toMatch(/prompt_/);
  });

  it('a folder named like a prompt file is not grok\'s file', async () => {
    const h = home();
    const r = await run(promptNo(48), h, (sid) => mkdirSync(join(folderOf(h, sid), 'prompts', 'prompt_0.txt'), { recursive: true }));
    expect(r.message ?? '').not.toMatch(SILENT);
  });

  // Review round 3: the sentence that attributes nothing listed every candidate (400 files, 45,345 characters).
  it('names at most the three latest files, in turn order', async () => {
    const h = home();
    const folder = folderOf(h, 'continued-session');
    const p = promptNo(49);
    const r = await run(p, h, () => {
      for (const n of [8, 9, 10, 11, 12]) {
        turn(folder, n, { file: true, note: offloadedNote('p'), prompt: p });
        setTime(join(folder, 'prompts', `prompt_${n}.txt`), 500 + n);
      }
    }, { continueSession: true });
    const m = r.message ?? '';
    expect(m).toMatch(HEDGED);
    expect(m).not.toContain('prompt_8.txt');
    expect(m).not.toContain('prompt_9.txt');
    expect(m.indexOf('prompt_10.txt')).toBeGreaterThan(-1);
    expect(m.indexOf('prompt_10.txt')).toBeLessThan(m.indexOf('prompt_11.txt'));
    expect(m.indexOf('prompt_11.txt')).toBeLessThan(m.indexOf('prompt_12.txt'));
    expect(m).toContain('외 2개');
  });

  // Review round 4: the regex that trimmed the ends backtracked over a long inner run of spaces — 160,000 of them took
  // 14.7 s and held the server. What grok was measured to trim and keep, and the time on such a run.
  it('trims as grok does — White_Space off the ends, a leading run of it and U+FEFF off, CRLF and inner runs kept — in linear time', () => {
    const c = String.fromCharCode;
    expect(keptByGrok(` ${c(10)}${c(0x85)}a${c(13)}${c(10)}b  c${c(0x200b)}`)).toBe(`a${c(13)}${c(10)}b  c${c(0x200b)}`);
    expect(keptByGrok(`abc ${c(10)}`)).toBe('abc');
    expect(keptByGrok(`${c(0xfeff)}abc`)).toBe('abc'); // 1.0.50 kept it, 1.0.52 drops it: no comparison looks at it
    // grok versions differ inside a leading run of blanks and U+FEFF (review round 5, measured): none of it is compared.
    for (const lead of [`${c(0xfeff)}${c(10)}`, `${c(10)}${c(0xfeff)}${c(10)}`, `${c(0x20)}${c(0xfeff)}${c(0x20)}`,
      `${c(0xfeff)}${c(0xfeff)}${c(0xfeff)}`]) expect(keptByGrok(`${lead}abc`)).toBe('abc');
    expect(keptByGrok(`a${c(0xfeff)}b${c(0xfeff)}`)).toBe(`a${c(0xfeff)}b${c(0xfeff)}`); // only the leading run
    expect(keptByGrok(`${c(0x200b)}abc`)).toBe(`${c(0x200b)}abc`);
    expect(keptByGrok(`a${c(0xd800)}b`)).toBe(`a${c(0xfffd)}b`); // what UTF-8 gave grok
    // Measured on 1.0.52 (review round 4): these went from the front too, and controls outside White_Space stayed; a lone
    // CR inside stayed in the file and the history.
    for (const gone of [0x09, 0x0b, 0x0c, 0x0d, 0xa0, 0x1680, 0x2003, 0x2028, 0x3000]) expect(keptByGrok(`${c(gone)}abc`)).toBe('abc');
    for (const kept of [0x01, 0x1b, 0x7f]) expect(keptByGrok(`${c(kept)}abc`)).toBe(`${c(kept)}abc`);
    expect(keptByGrok(`a${c(13)}b`)).toBe(`a${c(13)}b`);
    // The rest of the set is Rust's trim(): Unicode White_Space at either end, nothing else (a leading U+FEFF aside).
    const whiteSpace = /^\p{White_Space}$/u;
    const wrong: number[] = [];
    for (let code = 0; code <= 0xffff; code += 1) {
      if (code >= 0xd800 && code <= 0xdfff) continue; // a lone surrogate is U+FFFD by then
      const ch = c(code);
      const trimmed = whiteSpace.test(ch);
      if (keptByGrok(`${ch}a`) !== (trimmed || code === 0xfeff ? 'a' : `${ch}a`)
        || keptByGrok(`a${ch}`) !== (trimmed ? 'a' : `a${ch}`)) wrong.push(code);
    }
    expect(wrong).toEqual([]);
    const spaced = `${'x'.repeat(100_000)}${' '.repeat(200_000)}y`;
    const t0 = performance.now();
    expect(keptByGrok(spaced)).toBe(spaced);
    expect(performance.now() - t0).toBeLessThan(250);
  });

  // Review round 4: the time rule on numbers — whole seconds (FAT keeps even ones, HFS+ any) get 2 s, finer times 100 ms,
  // and 3 s after the check closes it.
  it('dates a file within the run by whole seconds or finer', () => {
    const spawn = 1_800_000_000_500;
    const check = spawn + 10_000;
    expect(writtenByTime(1_800_000_000_000, spawn, check)).toBe(true); // an even whole second 0.5 s before (FAT)
    expect(writtenByTime(1_799_999_999_000, spawn, check)).toBe(true); // an odd one 1.5 s before (HFS+)
    expect(writtenByTime(1_799_999_998_000, spawn, check)).toBe(false); // 2.5 s before
    expect(writtenByTime(spawn - 50, spawn, check)).toBe(true); // a finer time: the file clock trails the process clock
    expect(writtenByTime(spawn - 150, spawn, check)).toBe(false); // an earlier run's file
    expect(writtenByTime(check + 3_000, spawn, check)).toBe(true);
    expect(writtenByTime(check + 3_001, spawn, check)).toBe(false);
  });

  // Review round 4: the history is read from its size before the spawn where a listing was taken, and from the start in
  // the minted folder — a turn followed by more than 8 MiB of tool output is still read.
  it('reads this run\'s turn however much the run recorded after it', async () => {
    const h = home();
    const bulk = `${JSON.stringify({ type: 'tool_result', content: 'y'.repeat(90_000) })}\n`.repeat(100);
    const p = promptNo(50);
    const minted = await run(p, h, (sid) => {
      turn(folderOf(h, sid), 0, { file: false, note: NOT_SAVED, prompt: p });
      appendFileSync(join(folderOf(h, sid), 'chat_history.jsonl'), bulk);
    });
    expect(minted.message).toMatch(STRONG);
    const sid = 'a59-long-run';
    const folder = folderOf(h, sid);
    turn(folder, 0, { file: false, note: null, prompt: 'A59L000001|seed', whole: true });
    const q = promptNo(51);
    const resumed = await run(q, h, () => {
      turn(folder, 1, { file: true, note: offloadedNote('p'), prompt: q });
      appendFileSync(join(folder, 'chat_history.jsonl'), bulk);
    }, { resumeSessionId: sid });
    expect(resumed.message).toContain('prompt_1.txt');
    expect(resumed.message).toMatch(POINTED);
  });

  // Review round 4: a line counts as cut only when grok's note follows it — a shorter prompt recorded whole is not cut.
  it('a turn recorded whole is never read as a cut one', async () => {
    const h = home();
    const folder = folderOf(h, 'continued-session');
    const preamble = `${'Shared preamble for every worker. '.repeat(100)}\n`;
    const mine = fixture(99_980, { head: `${preamble}AAAAAA\n` }); // cut by grok
    const shorter = fixture(99_976, { head: `${preamble}AA\n` }); // the same lines, under the boundary: kept whole
    const r = await run(mine, h, () => turn(folder, 1, { file: false, note: null, prompt: shorter, whole: true }), { continueSession: true });
    expect(r.message ?? '').not.toMatch(SILENT);
  });

  it('a cut line that keeps less of either end than grok keeps is not this prompt\'s', async () => {
    const h = home();
    const folder = folderOf(h, 'continued-session');
    const p = promptNo(59);
    const full = kept(p);
    const shortHead = `${full.slice(0, 500)}${OMISSION}${full.slice(full.length - 4_000)}`;
    const r = await run(p, h, () => {
      mkdirSync(folder, { recursive: true });
      appendFileSync(join(folder, 'chat_history.jsonl'), historyLine(1, [`<user_query>\n${shortHead}\n</user_query>\n\n${NOT_SAVED}`]));
    }, { continueSession: true });
    expect(r.message ?? '').not.toMatch(SILENT);
  });

  // Review round 4: a later grok that numbers a new session's first turn otherwise, and one whose frame holds more than
  // the prompt — named, not dropped.
  it('a later layout still names the file: another first number, more inside the frame', async () => {
    const h = home();
    const p = promptNo(52);
    const one = await run(p, h, (sid) => turn(folderOf(h, sid), 1, { file: true, note: NOT_SAVED, prompt: p }));
    expect(one.message).toContain('prompt_1.txt');
    expect(one.message).toMatch(STRONG);
    // Without its file, a turn 1 there may be a joined run's: only turn 0 is known to be this run's (review round 5).
    const numberedOnly = await run(p, h, (sid) => turn(folderOf(h, sid), 1, { file: false, note: NOT_SAVED, prompt: p }));
    expect(numberedOnly.message).toMatch(HEDGED);
    expect(numberedOnly.message).not.toMatch(STRONG);
    const folder = folderOf(h, 'continued-session');
    const more = await run(p, h, () => {
      mkdirSync(join(folder, 'prompts'), { recursive: true });
      writeFileSync(join(folder, 'prompts', 'prompt_1.txt'), `<user_query>\n${'[attached: none] '.repeat(120)}\n${kept(p)}\n</user_query>`);
    }, { continueSession: true });
    expect(more.message).toContain('prompt_1.txt');
    expect(more.message).toMatch(HEDGED);
  });

  // Review round 4: in the minted folder a prompt_0.txt that holds a prompt without this one in it (a run that joined in
  // the same instant took the number) or is too short to hold this one (cut off while written) is not this run's.
  it('a new session\'s prompt_0.txt is this run\'s only if it can hold this prompt', async () => {
    const h = home();
    const p = promptNo(53);
    const taken = await run(p, h, (sid) => {
      turn(folderOf(h, sid), 0, { file: false, note: offloadedNote('p'), prompt: p });
      saveFile(folderOf(h, sid), 0, promptNo(54));
    });
    expect(taken.message).toMatch(HEDGED);
    expect(taken.message).not.toMatch(/prompt_/);
    // Turn 0 is this run's own: its note that the file was not saved says the middle was lost, whoever's prompt_0.txt is
    // there (review round 5).
    const takenLost = await run(p, h, (sid) => {
      turn(folderOf(h, sid), 0, { file: false, note: NOT_SAVED, prompt: p });
      saveFile(folderOf(h, sid), 0, promptNo(54));
    });
    expect(takenLost.message).toMatch(STRONG);
    expect(takenLost.message).not.toMatch(/prompt_/);
    const empty = await run(p, h, (sid) => {
      turn(folderOf(h, sid), 0, { file: false, note: offloadedNote('p'), prompt: p });
      writeFileSync(join(folderOf(h, sid), 'prompts', 'prompt_0.txt'), '');
    });
    expect(empty.message).toMatch(HEDGED);
    expect(empty.message).not.toMatch(ATTRIBUTED);
  });

  // Review round 4 (theoretical): the same prompt sent at once by two runs and only the other run's file saved — this
  // run's own cut turn, written during the run, left none. The one file may be the other run's.
  it('the same prompt sent at once with one file saved: that file is not called this run\'s', async () => {
    const h = home();
    const sid = 'a59-same-prompt';
    const folder = folderOf(h, sid);
    turn(folder, 0, { file: false, note: null, prompt: 'A59L000001|seed', whole: true });
    const p = promptNo(55);
    const r = await run(p, h, () => {
      turn(folder, 9, { file: true, note: offloadedNote('p'), prompt: p });
      turn(folder, 10, { file: false, note: NOT_SAVED, prompt: p });
    }, { resumeSessionId: sid });
    expect(r.message).toContain('prompt_9.txt');
    expect(r.message).toMatch(HEDGED);
    expect(r.message).not.toMatch(CLAIMS);
    // The same on a continue, which has no listing.
    const q = promptNo(60);
    const continued = await run(q, h, () => {
      const f = folderOf(h, 'continued-session');
      turn(f, 9, { file: true, note: offloadedNote('p'), prompt: q });
      turn(f, 10, { file: false, note: NOT_SAVED, prompt: q });
    }, { continueSession: true });
    expect(continued.message).toContain('prompt_9.txt');
    expect(continued.message).toMatch(HEDGED);
    expect(continued.message).not.toMatch(CLAIMS);
    // In the minted folder this run's turn is 0: with no prompt_0.txt, its not-saved note says the middle was lost whatever
    // a joined run's file holds, and with its file note a joined run's file is not named — another number's file is not
    // this run's once line 0 is recorded (review round 5).
    const lost = await run(q, h, (minted) => {
      turn(folderOf(h, minted), 0, { file: false, note: NOT_SAVED, prompt: q });
      turn(folderOf(h, minted), 1, { file: true, note: offloadedNote('p'), prompt: q });
    });
    expect(lost.message).toMatch(STRONG);
    expect(lost.message).not.toMatch(/prompt_/);
    const lostTwice = await run(q, h, (minted) => {
      turn(folderOf(h, minted), 0, { file: false, note: NOT_SAVED, prompt: q });
      turn(folderOf(h, minted), 1, { file: true, note: offloadedNote('p'), prompt: q });
      turn(folderOf(h, minted), 2, { file: true, note: offloadedNote('p'), prompt: q });
    });
    expect(lostTwice.message).toMatch(STRONG);
    expect(lostTwice.message).not.toMatch(/prompt_/);
    const pointed = await run(q, h, (minted) => {
      turn(folderOf(h, minted), 0, { file: false, note: offloadedNote('p'), prompt: q });
      turn(folderOf(h, minted), 1, { file: true, note: offloadedNote('p'), prompt: q });
    });
    expect(pointed.message).toMatch(HEDGED);
    expect(pointed.message).not.toMatch(/prompt_/);
    expect(pointed.message).not.toMatch(CLAIMS);
  });

  // Review round 5: on a resume a number has a file only by one written during the run. A cut turn of this prompt recorded
  // during the run over an older file of that number left none of its own, so this run's one file is not called its own.
  it('a turn recorded during a resume over an older file left no file of its own', async () => {
    const h = home();
    const sid = 'a59-over-old';
    const folder = folderOf(h, sid);
    const p = promptNo(61);
    turn(folder, 0, { file: false, note: null, prompt: 'A59L000001|seed', whole: true });
    saveFile(folder, 1, p); // an earlier attempt's file, in the listing
    const r = await run(p, h, () => {
      appendFileSync(join(folder, 'chat_history.jsonl'), historyLine(1, [`<user_query>\n${recorded(p)}\n</user_query>\n\n${NOT_SAVED}`]));
      turn(folder, 2, { file: true, note: offloadedNote('p'), prompt: p });
    }, { resumeSessionId: sid });
    expect(r.message).toContain('prompt_2.txt');
    expect(r.message).not.toContain('prompt_1.txt');
    expect(r.message).toMatch(HEDGED);
    expect(r.message).not.toMatch(CLAIMS);
  });

  // Review round 4: a prompt grok trimmed more of than this wrapper does (an unmeasured end character) is named, not
  // taken for another prompt.
  it('a file holding this prompt with less at its ends is named, not dropped', async () => {
    const h = home();
    const folder = folderOf(h, 'continued-session');
    const p = `${String.fromCharCode(0x1b)}${promptNo(56)}`; // an escape character first, as pasted ANSI output starts
    const r = await run(p, h, () => {
      mkdirSync(join(folder, 'prompts'), { recursive: true });
      writeFileSync(join(folder, 'prompts', 'prompt_1.txt'), `<user_query>\n${kept(promptNo(56))}\n</user_query>`);
    }, { continueSession: true });
    expect(r.message).toContain('prompt_1.txt');
    expect(r.message).toMatch(HEDGED);
    setTime(join(folder, 'prompts', 'prompt_1.txt'), -30_000);
    // Up to 1 KiB less: a thousand controls first that such a grok would drop (review rounds 5–6) — more than that and the
    // file is too short to hold this prompt.
    const q = `${String.fromCharCode(1).repeat(1_000)}${promptNo(62)}`;
    const thousand = await run(q, h, () => {
      writeFileSync(join(folder, 'prompts', 'prompt_2.txt'), `<user_query>\n${kept(promptNo(62))}\n</user_query>`);
    }, { continueSession: true });
    expect(thousand.message).toContain('prompt_2.txt');
    expect(thousand.message).toMatch(HEDGED);
    setTime(join(folder, 'prompts', 'prompt_2.txt'), -30_000);
    const tooShort = await run(`${String.fromCharCode(1).repeat(1_100)}${promptNo(63)}`, h, () => {
      writeFileSync(join(folder, 'prompts', 'prompt_3.txt'), `<user_query>\n${kept(promptNo(63))}\n</user_query>`);
    }, { continueSession: true });
    expect(tooShort.message ?? '').not.toMatch(SILENT);
  });

  // Review round 6: the minted folder's rules — line 0 is this run's, prompt_0.txt its file — hold only in the minted
  // folder. Elsewhere a line 0 of this prompt is an earlier run's turn.
  it('the minted folder\'s turn-0 rules apply only in the minted folder', async () => {
    const h = home();
    const folder = folderOf(h, 'continued-session');
    const p = promptNo(70);
    turn(folder, 0, { file: true, note: NOT_SAVED, prompt: p }); // an earlier run of this prompt, its first turn
    setTime(join(folder, 'prompts', 'prompt_0.txt'), -60_000);
    const resent = await run(p, h, () => turn(folder, 1, { file: true, note: offloadedNote('p'), prompt: p }), { continueSession: true });
    expect(resent.message).toContain('prompt_1.txt');
    expect(resent.message).not.toContain('prompt_0.txt');
    expect(resent.message).toMatch(POINTED);
    // A continue whose envelope names the session and whose only line of q there is an earlier turn 0 that says not saved:
    // that turn is not this run's (review round 7 — a timed-out continue, or one ending in an error, names no session).
    const h2 = home();
    const q = promptNo(71);
    turn(folderOf(h2, 'continued-session'), 0, { file: false, note: NOT_SAVED, prompt: q });
    const continued = await run(q, h2, () => {}, { continueSession: true });
    expect(continued.message).toMatch(HEDGED);
    expect(continued.message).not.toMatch(CLAIMS);
    const other = folderOf(h, 'reported-instead');
    const s = promptNo(72);
    turn(other, 0, { file: false, note: NOT_SAVED, prompt: s }); // the session the envelope names: an earlier turn 0
    const reported = await run(s, h, () => {}, {}, {}, 'reported-instead');
    expect(reported.message).toMatch(HEDGED);
    expect(reported.message ?? '').not.toMatch(CLAIMS);
  });

  // Review round 7: the rules round 6 stated, each pinned by a state whose sentence would change without it.
  it('pins the line-0 scope, the cut test and the shrunken history', async () => {
    const h = home();
    // Outside the minted folder a line 0 of this prompt is an earlier run's: another run's file-less cut turn still counts.
    const folder = folderOf(h, 'continued-session');
    const p = promptNo(76);
    turn(folder, 0, { file: true, note: offloadedNote('p'), prompt: p });
    setTime(join(folder, 'prompts', 'prompt_0.txt'), -60_000);
    const outside = await run(p, h, () => {
      turn(folder, 1, { file: false, note: NOT_SAVED, prompt: p });
      turn(folder, 2, { file: true, note: offloadedNote('p'), prompt: p });
    }, { continueSession: true });
    expect(outside.message).toMatch(HEDGED);
    expect(outside.message ?? '').not.toMatch(CLAIMS);
    // A note in words this wrapper does not know still marks a cut turn: hedged, not silent.
    const q = promptNo(77);
    const otherWords = await run(q, h, (sid) => turn(folderOf(h, sid), 0, { file: false, note: 'a note in other words', prompt: q }));
    expect(otherWords.message).toMatch(HEDGED);
    // In the minted folder with line 0 recorded only that line counts: a joiner's file-less cut turn does not unseat
    // prompt_0.txt, and a joiner's whole turn does not silence turn 0's not-saved note.
    const r = promptNo(78);
    const joinedCut = await run(r, h, (sid) => {
      turn(folderOf(h, sid), 0, { file: true, note: offloadedNote('p'), prompt: r });
      turn(folderOf(h, sid), 1, { file: false, note: NOT_SAVED, prompt: r });
    });
    expect(joinedCut.message).toContain('prompt_0.txt');
    expect(joinedCut.message).toMatch(POINTED);
    const s = promptNo(79);
    const joinedWhole = await run(s, h, (sid) => {
      turn(folderOf(h, sid), 0, { file: false, note: NOT_SAVED, prompt: s });
      turn(folderOf(h, sid), 1, { file: false, note: null, prompt: s, whole: true });
    });
    expect(joinedWhole.message).toMatch(STRONG);
    // A history shorter than before the spawn is read in its last 8 MiB, so this run's note is still read.
    const sid = 'a59-shrunk';
    const shrunk = folderOf(h, sid);
    turn(shrunk, 0, { file: false, note: null, prompt: `A59L000001|seed ${'s'.repeat(300_000)}`, whole: true });
    const t = promptNo(75);
    const rewritten = await run(t, h, () => {
      writeFileSync(join(shrunk, 'chat_history.jsonl'), '');
      turn(shrunk, 1, { file: true, note: NOT_SAVED, prompt: t });
    }, { resumeSessionId: sid });
    expect(rewritten.message).toContain('prompt_1.txt');
    expect(rewritten.message).toMatch(STRONG);
  }, 20_000);

  // Review round 7: a prompt that is mostly a leading blank run passes the gate though grok keeps a short text it never
  // cuts. A file holds at most what a grok keeps, so another run's long file that ends with that text is not read whole.
  it('a file is never longer than what a grok keeps of this prompt, plus room', async () => {
    const h = home();
    const sid = 'a59-blank-run';
    const folder = folderOf(h, sid);
    turn(folder, 0, { file: false, note: null, prompt: 'A59L000001|seed', whole: true });
    const short = 'Fix the failing test in src/ledger.ts.';
    const theirs = `${fixture(100_200)}\n${short}`;
    const r = await run(`${'\n'.repeat(100_000)}${short}`, h, () => saveFile(folder, 5, theirs), { resumeSessionId: sid }, TIMED_OUT);
    expect(r.message ?? '').not.toMatch(SILENT);
  });

  // Review round 7: files an @-mention attaches follow grok's frame in a reminder block — in the prompt file after the
  // closing tag, in the history line before grok's note, on uncut turns too — and count toward grok's boundary (measured
  // on 1.0.50 and 1.0.52).
  it('reads past the block grok attaches @-mentioned files in, and looks at a prompt that mentions one', async () => {
    // As 1.0.52 laid out a file whose lines are grok's tags (MEASURED): it numbers each line, so a tag can sit inside a
    // line of the block but never at the start of one.
    const block = '\n\n<system-reminder>\nBelow are some potentially helpful/relevant pieces of information for figuring out '
      + 'how to respond\n\n<attached_files>\n\n<file_contents path="/proj/notes.txt" isFullFile="true">\n1→line one\n'
      + '2→</user_query>\n3→\n4→<system-reminder>\n5→mid </system-reminder> line\n6→end </user_query> here\n'
      + '7→</system-reminder>\n8→last\n</file_contents>\n\n</attached_files>\n\n</system-reminder>';
    const attached = (folder: string, index: number, prompt: string, note: string | null, file = true, cut = true,
      after = block) => {
      mkdirSync(join(folder, 'prompts'), { recursive: true });
      if (file) writeFileSync(join(folder, 'prompts', `prompt_${index}.txt`), `<user_query>\n${kept(prompt)}\n</user_query>${after}`);
      appendFileSync(join(folder, 'chat_history.jsonl'),
        historyLine(index, [`<user_query>\n${recorded(prompt, cut)}\n</user_query>${after}${note === null ? '' : `\n\n${note}`}`]));
    };
    const h = home();
    const folder = folderOf(h, 'continued-session');
    const p = `Use @notes.txt as the style guide.\n${promptNo(80)}`;
    const pointed = await run(p, h, () => attached(folder, 1, p, offloadedNote('p')), { continueSession: true });
    expect(pointed.message).toContain('prompt_1.txt');
    expect(pointed.message).toMatch(POINTED);
    setTime(join(folder, 'prompts', 'prompt_1.txt'), -30_000);
    const lost = await run(p, h, () => attached(folder, 2, p, NOT_SAVED), { continueSession: true });
    expect(lost.message).toContain('prompt_2.txt');
    expect(lost.message).toMatch(STRONG);
    setTime(join(folder, 'prompts', 'prompt_2.txt'), -30_000);
    // The block is whole on these turns, so grok cut the prompt alone: the files are not named (review round 9).
    expect(pointed.message).toMatch(/프롬프트\([\d,]+바이트\)가 길어/);
    expect(pointed.message).toContain('요청에 앞부분과 끝부분만 넣고 빠진 줄은 그 파일에서 읽으라고');
    expect(lost.message).toContain('프롬프트의 가운데는 모델에 닿지 않았습니다');
    for (const said of [pointed.message, lost.message]) expect(said).not.toContain('붙인 파일의 뒷부분');
    // An earlier turn of a look-alike prompt — this one without 2,000 characters of its middle, so grok kept it whole —
    // recorded with a block (whose lines hold the end tag) and no note was not cut: it does not stop this run's own file
    // being named.
    const h2 = home();
    const folder2 = folderOf(h2, 'continued-session');
    const mine = `Use @notes.txt as the style guide.\n${promptNo(83)}`;
    const earlier = mine.slice(0, 40_000) + mine.slice(42_000);
    const notCut = await run(mine, h2, () => {
      attached(folder2, 1, earlier, null, false, false);
      attached(folder2, 2, mine, NOT_SAVED);
    }, { continueSession: true });
    expect(notCut.message).toContain('prompt_2.txt');
    expect(notCut.message).toMatch(STRONG);
    // Under the boundary a prompt that mentions a file is looked at, and the sentence says the file made it long; one
    // that mentions none is not.
    const h3 = home();
    const under = `Use @notes.txt as the style guide.\n${fixture(99_000)}`;
    const mentioned = await run(under, h3, (sid) => attached(folderOf(h3, sid), 0, under, offloadedNote('p')));
    expect(mentioned.message).toContain('prompt_0.txt');
    expect(mentioned.message).toMatch(/@로 붙인 파일이 길어/);
    expect(mentioned.message).toMatch(POINTED);
    const plain = fixture(99_000);
    const unmentioned = await run(plain, h3, (sid) => attached(folderOf(h3, sid), 0, plain, offloadedNote('p')));
    expect(unmentioned.message ?? '').not.toMatch(SILENT);
    // An @ after a letter, a digit or an underscore attaches nothing (measured on 1.0.52); after ":" it does.
    const mail = `Mail admin@example.com, user_@name, 2@3 and 한글@이름, as they are.\n${fixture(99_000)}`;
    const unmailed = await run(mail, h3, (sid) => attached(folderOf(h3, sid), 0, mail, offloadedNote('p')));
    expect(unmailed.message ?? '').not.toMatch(SILENT);
    // Review round 13: grok skips White_Space between the @ and the word (measured on 1.0.52: "@ f.txt", two spaces, a
    // TAB, U+00A0, U+3000, U+0085, a line break and an empty line attached the file) — such a prompt is looked at too.
    for (const gap of [' ', '  ', '\t', '\n', '\r\n', '\n\n', String.fromCharCode(0xa0), String.fromCharCode(0x3000),
      String.fromCharCode(0x85)]) {
      const spaced = `Meet @${gap}noon.txt today.\n${fixture(99_000)}`;
      const looked = await run(spaced, h3, (sid) => attached(folderOf(h3, sid), 0, spaced, offloadedNote('p')));
      expect(looked.message, JSON.stringify(gap)).toMatch(POINTED);
    }
    // Under the boundary only what grok added can have made the request long: a turn that shows no attached files' tag (a
    // later layout) still has them named for a prompt that may mention one (review round 13).
    const untagged = `Use @ notes.txt as the style guide.\n${fixture(99_000)}`;
    const named = await run(untagged, h3, (sid) => turn(folderOf(h3, sid), 0, { file: true, note: offloadedNote('p'), prompt: untagged }));
    expect(named.message).toMatch(/^프롬프트\([\d,]+바이트\)와 @로 붙인 파일이 길어/);
    // At the boundary itself the prompt alone was long enough, so the same turn names the prompt only (the mutation check
    // after round 13's fixes: the subject's boundary off by one passed every test).
    for (const [size, subject] of [[99_977, /^프롬프트\(99,977바이트\)가 길어/], [99_976, /^프롬프트\(99,976바이트\)와 @로 붙인 파일이 길어/]] as const) {
      const edge = fixture(size, { head: 'Use @ notes.txt as the style guide.\n' });
      const edged = await run(edge, h3, (sid) => turn(folderOf(h3, sid), 0, { file: true, note: offloadedNote('p'), prompt: edge }));
      expect(edged.message, String(size)).toMatch(subject);
    }
    // A digit that is not a decimal one does not stop the look (not measured either way, so the look errs toward it).
    for (const listed of [`Files:@notes.txt\n${fixture(99_000)}`, `Files${String.fromCharCode(0xb2)}@notes.txt\n${fixture(99_000)}`]) {
      const looked = await run(listed, h3, (sid) => attached(folderOf(h3, sid), 0, listed, offloadedNote('p')));
      expect(looked.message, listed.slice(0, 20)).toMatch(POINTED);
    }
    // Such a prompt gets the listing before the spawn too, so a new session's turn 0 decides as for any long prompt.
    const lostHome = home();
    const lostUnder = await run(under, lostHome, (sid) => attached(folderOf(lostHome, sid), 0, under, NOT_SAVED, false));
    expect(lostUnder.message).toMatch(STRONG);
    // A file whose attachments take it past what a prompt's file can be is read whole, with room for them — where no
    // listing was taken, so nothing but its content makes it this run's. 2 MiB of them: more than 1 MiB of room would hold.
    const h4 = home();
    const folder4 = folderOf(h4, 'continued-session');
    const big = `Use @notes.txt as the style guide.\n${promptNo(81)}`;
    const huge = await run(big, h4, () => {
      mkdirSync(join(folder4, 'prompts'), { recursive: true });
      const filler = `\n<file_contents path="/proj/big.txt" isFullFile="true">\n1→${'b'.repeat(2 * 1024 * 1024)}\n</file_contents>`;
      writeFileSync(join(folder4, 'prompts', 'prompt_1.txt'),
        `<user_query>\n${kept(big)}\n</user_query>${block.replace('\n\n</attached_files>', `${filler}\n\n</attached_files>`)}`);
      appendFileSync(join(folder4, 'chat_history.jsonl'),
        historyLine(1, [`<user_query>\n${recorded(big)}\n</user_query>${block}\n\n${offloadedNote('p')}`]));
    }, { continueSession: true });
    expect(huge.message).toContain('prompt_1.txt');
    expect(huge.message).toMatch(ATTRIBUTED);
    expect(huge.message).toMatch(POINTED);
    // A prompt can quote the closing tag followed by the block's opening, an attached file cannot: the last such pair, and
    // only where a block follows it, ends the query — with a block after it and without one.
    const lines = promptNo(82).split('\n');
    const quote = (lead: string) => [lead, ...lines.slice(0, 30), '</user_query>', '', '<system-reminder>', ...lines.slice(30)].join('\n');
    // Where no listing was taken, so the file's content alone makes it this run's.
    for (const lead of ['Fix the style.', 'Use @notes.txt as the style guide.']) {
      const h5 = home();
      const folder5 = folderOf(h5, 'continued-session');
      const quoting = quote(lead);
      const quoted = await run(quoting, h5, () => attached(folder5, 1, quoting, offloadedNote('p'), true, true,
        lead.includes('@') ? block : ''), { continueSession: true });
      expect(quoted.message, lead).toContain('prompt_1.txt');
      expect(quoted.message, lead).toMatch(ATTRIBUTED);
      expect(quoted.message, lead).toMatch(POINTED);
    }
  }, 30_000);

  // Review round 8 (MEASURED on 1.0.52 by two reviewers and again here): when the files a prompt mentions overflow grok's
  // request, grok keeps the query whole (up to about 75 KB) and cuts the files at their end, with no mark — the history
  // line's block loses its end and grok's note, "attached context lines …", follows the cut — and still saves the whole
  // request to the prompt file.
  describe('attached files grok cut', () => {
    const header = '\n\n<system-reminder>\nBelow are some potentially helpful/relevant pieces of information for figuring out '
      + 'how to respond\n\n<attached_files>\n\n';
    // A file whose lines are grok's own tags, as grok laid one out (numbered — measured).
    const tags = '<file_contents path="/proj/tags.txt" isFullFile="true">\n1→line one\n2→</user_query>\n3→\n4→<system-reminder>\n'
      + '5→mid </system-reminder> line\n6→end </user_query> here\n7→</system-reminder>\n8→last\n</file_contents>';
    const numbered = (n: number) => `<file_contents path="/proj/f${n}.txt" isFullFile="true">\n`
      + Array.from({ length: 5 }, (_, i) => `${i + 1}→F${n}L${String(i + 1).padStart(4, '0')}|${'y'.repeat(80)}`).join('\n')
      + '\n</file_contents>';
    const fullBlock = `${header}${tags}\n\n${numbered(1)}\n\n</attached_files>\n\n</system-reminder>`;
    // The history line's block as grok cut it: the last file stops inside a line and the block's end is gone.
    const cutBlock = `${header}${tags}\n\n${numbered(1).slice(0, 200)}`;
    const attachedNote = (path: string) => offloadedNote(path)
      .replace('user query lines 945–961', 'attached context lines 1061–1253').replace('offset=945, limit=17', 'offset=1061, limit=193');
    const write = (folder: string, index: number, prompt: string, note: string, { file = true, cutPrompt = false } = {}) => {
      mkdirSync(join(folder, 'prompts'), { recursive: true });
      if (file) writeFileSync(join(folder, 'prompts', `prompt_${index}.txt`), `<user_query>\n${kept(prompt)}\n</user_query>${fullBlock}`);
      appendFileSync(join(folder, 'chat_history.jsonl'),
        historyLine(index, [`<user_query>\n${recorded(prompt, cutPrompt)}\n</user_query>${cutBlock}\n\n${note}`]));
    };
    const FILES_LOST = /붙인 파일의 뒷부분은 모델에 닿지 않았습니다/;
    const short = 'Review @tags.txt and @f1.txt and summarise them.';

    it('a prompt kept whole whose files grok cut is reported in a new session', async () => {
      const h = home();
      const pointed = await run(short, h, (sid) => write(folderOf(h, sid), 0, short, attachedNote('p')));
      expect(pointed.message).toContain('prompt_0.txt');
      expect(pointed.message).toMatch(/^프롬프트\([\d,]+바이트\)와 @로 붙인 파일이 길어 grok이 전문을 /);
      expect(pointed.message).toContain('요청에서 @로 붙인 파일의 뒷부분을 빼고 빠진 줄은 저장한 파일에서 읽으라고 적었습니다');
      const lost = await run(short, h, (sid) => write(folderOf(h, sid), 0, short, NOT_SAVED));
      expect(lost.message).toContain('prompt_0.txt');
      expect(lost.message).toMatch(FILES_LOST);
      expect(lost.message).not.toMatch(/프롬프트의 가운데/);
      const lostNoFile = await run(short, h, (sid) => write(folderOf(h, sid), 0, short, NOT_SAVED, { file: false }));
      expect(lostNoFile.message).toMatch(FILES_LOST);
      expect(lostNoFile.message).not.toContain('prompt_');
      expect(lostNoFile.message).toContain('@ 없이 경로만 적어');
      // The same turn with its block whole and no note was not cut: nothing is said.
      const whole = await run(short, h, (sid) => {
        const folder = folderOf(h, sid);
        mkdirSync(folder, { recursive: true });
        appendFileSync(join(folder, 'chat_history.jsonl'), historyLine(0, [`<user_query>\n${kept(short)}\n</user_query>${fullBlock}`]));
      });
      expect(whole.message ?? '').not.toMatch(SILENT);
    }, 30_000);

    it('a long prompt grok cut together with its files names both, and a resume and a continue are reported', async () => {
      const h = home();
      const long = `Use @tags.txt and @f1.txt.\n${promptNo(84)}`;
      const both = await run(long, h, (sid) => write(folderOf(h, sid), 0, long, NOT_SAVED, { cutPrompt: true }));
      expect(both.message).toMatch(/^프롬프트\([\d,]+바이트\)와 @로 붙인 파일이 길어/);
      expect(both.message).toMatch(/프롬프트의 가운데와 붙인 파일의 뒷부분은 모델에 닿지 않았습니다/);
      const bothPointed = await run(long, h, (sid) => write(folderOf(h, sid), 0, long, attachedNote('p'), { cutPrompt: true }));
      expect(bothPointed.message).toContain('프롬프트의 앞부분과 끝부분만 넣고 @로 붙인 파일의 뒷부분은 빼고 빠진 줄은');
      const sid = 'a59-attach-resume';
      const resumed = folderOf(h, sid);
      turn(resumed, 0, { file: false, note: null, prompt: 'A59L000001|seed', whole: true });
      const onResume = await run(short, h, () => write(resumed, 1, short, attachedNote('p')), { resumeSessionId: sid });
      expect(onResume.message).toContain('prompt_1.txt');
      expect(onResume.message).toMatch(POINTED);
      const h2 = home();
      const onContinue = await run(short, h2, () => write(folderOf(h2, 'continued-session'), 1, short, attachedNote('p')),
        { continueSession: true });
      expect(onContinue.message).toContain('prompt_1.txt');
      expect(onContinue.message).toMatch(POINTED);
    }, 30_000);

    it('a file with the block is bounded by its frame, read whole, and an empty frame holds nothing', async () => {
      // Another run's prompt that is this one, then grok's closing tag and the block's opening quoted, then 70 KiB: read
      // whole, its frame ends at the last such pair and runs past what this prompt's can be, so it is not this run's (review
      // round 8: read only to the bound, the quote ended the frame there and the file passed for this run's).
      const h = home();
      const sid = 'a59-quoted-pair';
      const folder = folderOf(h, sid);
      turn(folder, 0, { file: false, note: null, prompt: 'A59L000001|seed', whole: true });
      const p = `Use @f1.txt.\n${promptNo(85)}`;
      const theirs = `<user_query>\n${kept(p)}\n</user_query>\n\n<system-reminder>\n${'z'.repeat(70 * 1024)}\n</user_query>${fullBlock}`;
      const quoted = await run(p, h, () => {
        mkdirSync(join(folder, 'prompts'), { recursive: true });
        writeFileSync(join(folder, 'prompts', 'prompt_5.txt'), theirs);
      }, { resumeSessionId: sid }, TIMED_OUT);
      expect(quoted.message ?? '').not.toMatch(SILENT);
      // A file that ends like the block but holds no frame before one is another layout: named, not called this run's.
      const h2 = home();
      const folder2 = folderOf(h2, 'continued-session');
      const unframed = await run(p, h2, () => {
        mkdirSync(join(folder2, 'prompts'), { recursive: true });
        writeFileSync(join(folder2, 'prompts', 'prompt_1.txt'), `${kept(p)}${fullBlock}`);
      }, { continueSession: true });
      expect(unframed.message).toMatch(HEDGED);
      expect(unframed.message).toContain('prompt_1.txt');
      // A short prompt's empty file, or a frame around nothing, from a run that ended before its turn holds nothing.
      for (const content of ['', '<user_query>\n \n</user_query>']) {
        const h3 = home();
        const empty = await run(short, h3, (sid3) => {
          mkdirSync(join(folderOf(h3, sid3), 'prompts'), { recursive: true });
          writeFileSync(join(folderOf(h3, sid3), 'prompts', 'prompt_0.txt'), content);
        }, {}, TIMED_OUT);
        expect(empty.message ?? '', JSON.stringify(content)).not.toMatch(SILENT);
      }
    }, 30_000);

    // A turn of this prompt grok kept whole: the query whole, then the block whole, and no note (MEASURED on 1.0.52).
    const keptWhole = (folder: string, index: number, prompt: string, after = fullBlock) => {
      mkdirSync(folder, { recursive: true });
      appendFileSync(join(folder, 'chat_history.jsonl'), historyLine(index, [`<user_query>\n${kept(prompt)}\n</user_query>${after}`]));
    };

    // Review round 9: the files a prompt @-mentions can grow between runs, so grok can keep the same prompt whole on one
    // run and cut its files on the next — one whole turn of it says nothing of another (code MINOR-1, adversarial NIT-1).
    it('a whole turn of the same @-mention prompt neither silences a cut turn nor makes a cut file this run\'s', async () => {
      // A continue (no listing): an earlier run kept it whole, this run's turn has its files cut and no file of it is seen.
      const h = home();
      const folder = folderOf(h, 'continued-session');
      keptWhole(folder, 0, short);
      const noFile = await run(short, h, () => write(folder, 1, short, NOT_SAVED, { file: false }), { continueSession: true });
      expect(noFile.message).toMatch(HEDGED);
      expect(noFile.message).not.toMatch(CLAIMS);
      // …its file dated where its time does not make it this run's (a skewed clock): named, not tied to this run.
      const h2 = home();
      const folder2 = folderOf(h2, 'continued-session');
      keptWhole(folder2, 0, short);
      const skewed = await run(short, h2, () => {
        write(folder2, 1, short, NOT_SAVED);
        setTime(join(folder2, 'prompts', 'prompt_1.txt'), 60_000);
      }, { continueSession: true });
      expect(skewed.message).toContain('prompt_1.txt');
      expect(skewed.message).toMatch(HEDGED);
      expect(skewed.message).not.toMatch(CLAIMS);
      // An earlier run's cut file dated on FAT's even second falls within this run's time, but a later turn of this
      // prompt was kept whole — this run's may be that one: the file is named, not called this run's.
      const h3 = home();
      const folder3 = folderOf(h3, 'continued-session');
      write(folder3, 1, short, NOT_SAVED);
      const fat = await run(short, h3, () => {
        fatTime(join(folder3, 'prompts', 'prompt_1.txt'));
        keptWhole(folder3, 2, short);
      }, { continueSession: true });
      expect(fat.message).toContain('prompt_1.txt');
      expect(fat.message).toMatch(HEDGED);
      expect(fat.message).not.toMatch(CLAIMS);
      expect(fat.message).not.toMatch(ATTRIBUTED);
    }, 30_000);

    // Review round 9: a block that lost its end makes a turn cut only with a known mark after it. Another end, another
    // reminder after the block or the block on its own line — later layouts — say nothing on an uncut turn (adversarial
    // MINOR-2, code NIT-1); a note in other words after a cut block reads no mark an attached file quotes (code NIT-2).
    it('only grok\'s known mark makes a turn cut, and an attached file\'s quote of one is not read', async () => {
      const layouts = [
        fullBlock.replace(/\n\n<\/system-reminder>$/, '\n</system-reminder>'),
        `${fullBlock}\n\n<system-reminder>\nThe user has /proj/x.ts open in the IDE.\n</system-reminder>`,
        fullBlock.slice(1),
      ];
      for (const after of layouts) {
        const h = home();
        const r = await run(short, h, (sid) => keptWhole(folderOf(h, sid), 0, short, after));
        expect(r.message ?? '', JSON.stringify(after.slice(-40))).not.toMatch(SILENT);
      }
      // Such a block after a cut query, with grok's file note naming the query's lines only: grok's note says what it
      // left out, so the files are not named (docs MINOR-5's first example).
      const long = `Use @tags.txt and @f1.txt.\n${promptNo(87)}`;
      const hl = home();
      const queryOnly = await run(long, hl, (sid) => {
        const folder = folderOf(hl, sid);
        mkdirSync(join(folder, 'prompts'), { recursive: true });
        writeFileSync(join(folder, 'prompts', 'prompt_0.txt'), `<user_query>\n${kept(long)}\n</user_query>${fullBlock}`);
        appendFileSync(join(folder, 'chat_history.jsonl'),
          historyLine(0, [`<user_query>\n${recorded(long)}\n</user_query>${layouts[0]}\n\n${offloadedNote('p')}`]));
      });
      expect(queryOnly.message).toMatch(/^프롬프트\([\d,]+바이트\)가 길어 grok이 전문을 /);
      expect(queryOnly.message).toContain('요청에 앞부분과 끝부분만 넣고 빠진 줄은 그 파일에서 읽으라고');
      expect(queryOnly.message).not.toContain('붙인 파일의 뒷부분');
      // A cut block whose last file quotes grok's not-saved note, then a note in words this wrapper does not know.
      const quoting = `${header}${tags}\n\n<file_contents path="/proj/q.txt" isFullFile="true">\n1→The wrapper reads ${NOT_SAVED}\n2→mo`;
      const reworded = (folder: string, withFile: boolean) => {
        mkdirSync(join(folder, 'prompts'), { recursive: true });
        if (withFile) writeFileSync(join(folder, 'prompts', 'prompt_0.txt'), `<user_query>\n${kept(short)}\n</user_query>${fullBlock}`);
        appendFileSync(join(folder, 'chat_history.jsonl'), historyLine(0, [`<user_query>\n${kept(short)}\n</user_query>${quoting}\n\n`
          + '[A later grok says it in other words: the request was cut.]']));
      };
      const h = home();
      const filed = await run(short, h, (sid) => reworded(folderOf(h, sid), true));
      expect(filed.message).toContain('prompt_0.txt');
      expect(filed.message).toMatch(ATTRIBUTED);
      expect(filed.message).not.toMatch(CLAIMS);
      const unfiled = await run(short, h, (sid) => reworded(folderOf(h, sid), false));
      expect(unfiled.message ?? '').not.toMatch(CLAIMS);
    }, 30_000);

    // Review round 9 (code NIT-4): the bounds and the cut test, each pinned by a state whose sentence changes without it.
    it('pins the room for attached files, the unframed oversize frame and a cut query with no note', async () => {
      // A file that ends in the block but is longer than the room allows is not read: named, not called this run's.
      const h = home();
      const folder = folderOf(h, 'continued-session');
      const tooBig = await run(short, h, () => {
        write(folder, 1, short, attachedNote('p'));
        const entry = `<file_contents path="/proj/big.txt" isFullFile="true">\n1→${'b'.repeat(8 * 1024 * 1024 + 70 * 1024)}\n</file_contents>`;
        writeFileSync(join(folder, 'prompts', 'prompt_1.txt'),
          `<user_query>\n${kept(short)}\n</user_query>${fullBlock.replace('\n\n</attached_files>', `\n\n${entry}\n\n</attached_files>`)}`);
      }, { continueSession: true });
      expect(tooBig.message).toContain('prompt_1.txt');
      expect(tooBig.message).toMatch(HEDGED);
      expect(tooBig.message).not.toMatch(CLAIMS);
      // A file that ends in the block whose frame part holds no frame start and is longer than this prompt's can be.
      const h2 = home();
      const folder2 = folderOf(h2, 'continued-session');
      const unframed = await run(short, h2, () => {
        write(folder2, 1, short, attachedNote('p'));
        writeFileSync(join(folder2, 'prompts', 'prompt_1.txt'), `${'z'.repeat(70 * 1024)}${kept(short)}\n</user_query>${fullBlock}`);
      }, { continueSession: true });
      expect(unframed.message).toContain('prompt_1.txt');
      expect(unframed.message).toMatch(HEDGED);
      // A cut query with no note after it is neither whole nor cut: this run's file is named, and what grok's request held
      // is not said. Its line still names its file where no listing was taken.
      const h3 = home();
      const p = promptNo(86);
      const noNote = await run(p, h3, (sid) => turn(folderOf(h3, sid), 0, { file: true, note: null, prompt: p }));
      expect(noNote.message).toContain('prompt_0.txt');
      expect(noNote.message).toMatch(ATTRIBUTED);
      expect(noNote.message).not.toMatch(CLAIMS);
      const h4 = home();
      const folder4 = folderOf(h4, 'continued-session');
      turn(folder4, 1, { file: true, note: null, prompt: p });
      setTime(join(folder4, 'prompts', 'prompt_1.txt'), -60_000);
      const older = await run(p, h4, () => {}, { continueSession: true });
      expect(older.message).toContain('prompt_1.txt');
      expect(older.message).toMatch(HEDGED);
    }, 60_000);

    /** One user line of this prompt in grok's layout: the query (whole or cut), then whatever grok put after it. */
    const lineOf = (folder: string, index: number, prompt: string, after: string, cutQuery = false) => {
      mkdirSync(folder, { recursive: true });
      appendFileSync(join(folder, 'chat_history.jsonl'),
        historyLine(index, [`<user_query>\n${recorded(prompt, cutQuery)}\n</user_query>${after}`]));
    };
    /** grok's prompt file for that turn: the whole request — the block whole, where the prompt mentions files. */
    const fileOf = (folder: string, index: number, prompt: string) => {
      mkdirSync(join(folder, 'prompts'), { recursive: true });
      const path = join(folder, 'prompts', `prompt_${index}.txt`);
      writeFileSync(path, `<user_query>\n${kept(prompt)}\n</user_query>${prompt.includes('@') ? fullBlock : ''}`);
      return path;
    };
    /** This run's turn 0 in its own session, with or without its file. */
    const minted = (prompt: string, after: string, { cutQuery = false, file = false } = {}) => {
      const h = home();
      return run(prompt, h, (sid) => {
        if (file) fileOf(folderOf(h, sid), 0, prompt);
        lineOf(folderOf(h, sid), 0, prompt, after, cutQuery);
      });
    };

    // Review round 10 (measured with grok 1.0.52 through the bundle by two reviewers): which of a prompt's turns came
    // last decides, by prompt_index as the doubted rule does; and under a listing a whole turn of this prompt doubts
    // the file whatever its number, the lines read being those grok appended during the run.
    it('the latest turn of a prompt decides, and a resume doubts a file another run of its prompt wrote', async () => {
      // A continue re-sends the prompt after an earlier run of it had its files cut and the files were made smaller, as
      // the advice says: grok kept this run's request whole and wrote no file. Nothing is said, earlier file or not.
      for (const withFile of [true, false]) {
        const h = home();
        const folder = folderOf(h, 'continued-session');
        if (withFile) setTime(fileOf(folder, 0, short), -30_000);
        lineOf(folder, 0, short, `${cutBlock}\n\n${attachedNote('p')}`);
        const r = await run(short, h, () => lineOf(folder, 1, short, fullBlock), { continueSession: true });
        expect(r.message ?? '', `earlier file: ${withFile}`).not.toMatch(SILENT);
      }
      // Two resumes of one prompt at once: this run's grok kept it whole (turn 1), the other's cut the grown files (turn
      // 2, its file). Neither that file nor its note is this run's.
      for (const note of [attachedNote('p'), NOT_SAVED]) {
        const h = home();
        const sid = 'a59-two-resumes';
        const folder = folderOf(h, sid);
        lineOf(folder, 0, 'A59L000001|seed', '');
        const r = await run(short, h, () => {
          lineOf(folder, 1, short, fullBlock);
          fileOf(folder, 2, short);
          lineOf(folder, 2, short, `${cutBlock}\n\n${note}`);
        }, { resumeSessionId: sid });
        expect(r.message, note.slice(0, 20)).toContain('prompt_2.txt');
        expect(r.message, note.slice(0, 20)).toMatch(HEDGED);
        expect(r.message, note.slice(0, 20)).not.toMatch(CLAIMS);
      }
    }, 30_000);

    // Review round 10: grok's note is the last of its marks that starts a line, wherever it sits after the query — after
    // a whole block or a cut one, before a reminder, followed by an empty line or holding one. A mark an attached file
    // quotes, at the head of a numbered line, is not one, and after a reminder no other text counts.
    it('grok\'s note is the last of its marks that starts a line, and after a reminder nothing else counts', async () => {
      const reminder = '\n\n<system-reminder>\nThe todo list is empty.\n\n</system-reminder>';
      const followed = await minted(short, `${cutBlock}\n\n${NOT_SAVED}\n\n`);
      expect(followed.message).toMatch(FILES_LOST);
      const inner = await minted(short, `${cutBlock}\n\n${attachedNote('p').replace('\nLines of', '\n\nLines of')}`, { file: true });
      expect(inner.message).toContain('요청에서 @로 붙인 파일의 뒷부분을 빼고 빠진 줄은 저장한 파일에서 읽으라고');
      const long = `Use @tags.txt and @f1.txt.\n${promptNo(88)}`;
      const beforeReminder = await minted(long, `${fullBlock}\n\n${offloadedNote('p')}${reminder}`, { cutQuery: true, file: true });
      expect(beforeReminder.message).toContain('요청에 앞부분과 끝부분만 넣고 빠진 줄은 그 파일에서 읽으라고');
      const filesBeforeReminder = await minted(short, `${cutBlock}\n\n${attachedNote('p')}${reminder}`, { file: true });
      expect(filesBeforeReminder.message).toContain('요청에서 @로 붙인 파일의 뒷부분을 빼고 빠진 줄은 저장한 파일에서 읽으라고');
      // The block's end is looked for before the note: a reminder after it, ending as the block does, does not close it.
      const lostBeforeReminder = await minted(short, `${cutBlock}\n\n${NOT_SAVED}${reminder}`);
      expect(lostBeforeReminder.message).toMatch(FILES_LOST);
      // A note right after the query's closing tag, with no line break before it, is read too.
      const atStart = await minted(promptNo(94), NOT_SAVED, { cutQuery: true });
      expect(atStart.message).toContain('프롬프트의 가운데는 모델에 닿지 않았습니다');
      // A prompt with no @ is cut on every turn: a reminder after its note hides nothing, and one before it names no file.
      for (const file of [false, true]) {
        const p = promptNo(89);
        const lost = await minted(p, `\n\n${NOT_SAVED}${reminder}`, { cutQuery: true, file });
        expect(lost.message, String(file)).toContain('프롬프트의 가운데는 모델에 닿지 않았습니다');
      }
      const ahead = await minted(promptNo(90), `\n\n<system-reminder>\nThe todo list is empty.\n</system-reminder>\n\n${NOT_SAVED}`,
        { cutQuery: true });
      expect(ahead.message).toContain('프롬프트의 가운데는 모델에 닿지 않았습니다');
      expect(ahead.message).not.toContain('붙인 파일');
      // Not a note: a mark an attached file quotes at the head of its line, and a whole block's plain-text trailer.
      const quoting = `${header}<file_contents path="/proj/q.txt" isFullFile="true">\n1→${NOT_SAVED}\n2→mo`;
      const quoted = await minted(short, `${quoting}\n\n[A later grok says it in other words.]`);
      expect(quoted.message ?? '').not.toMatch(SILENT);
      const trailer = await minted(short, `${fullBlock}\n\nThe user has /proj/f1.txt open in the IDE.`);
      expect(trailer.message ?? '').not.toMatch(SILENT);
    }, 30_000);

    // Review round 10 (code NIT-1): rules no test pinned, each by a state whose sentence changes without it.
    it('pins the cut test, the whole test, the latest-turn order and what names the files', async () => {
      // A whole block followed by grok's file note naming attached lines: cut, so not whole — the files are named.
      const named = await minted(short, `${fullBlock}\n\n${attachedNote('p')}`, { file: true });
      expect(named.message).toContain('요청에서 @로 붙인 파일의 뒷부분을 빼고');
      // A prompt recorded whole and followed by a line break only: no note, so nothing is said.
      const blank = await minted(promptNo(91), '\n');
      expect(blank.message ?? '').not.toMatch(SILENT);
      // An earlier whole turn, then this run's cut one with a note in other words and no file: hedged.
      const h = home();
      const folder = folderOf(h, 'continued-session');
      const p = promptNo(92);
      lineOf(folder, 0, p, '');
      const later = await run(p, h, () => lineOf(folder, 1, p, '\n\n[A later grok says it in other words.]', true),
        { continueSession: true });
      expect(later.message).toMatch(HEDGED);
      // A block that lost its end and a note this wrapper does not know: the files are not named, in the subject either.
      const open = `Use @tags.txt and @f1.txt.\n${promptNo(93)}`;
      const unknown = await minted(open, `${cutBlock}\n\n[A later grok says it in other words.]`, { cutQuery: true, file: true });
      expect(unknown.message).toMatch(/^프롬프트\([\d,]+바이트\)가 길어 grok이 전문을 /);
      expect(unknown.message).not.toMatch(CLAIMS);
    }, 30_000);

    // Review round 11: under a listing the order of turns proves nothing — the lines read are those grok appended during
    // the run — so a whole turn after this run's cut one does not silence it; only a turn whose block holds the attached
    // files' tag before the note had files attached; and the layouts round 10 made room for are pinned.
    it('under a listing order proves nothing, files need their tag, and round 10\'s tolerances hold', async () => {
      // A resume: this run's turn cut (not saved, no file), another run's turn of the prompt kept whole after it.
      const h = home();
      const sid = 'a59-cut-then-whole';
      const folder = folderOf(h, sid);
      lineOf(folder, 0, 'A59L000001|seed', '');
      const ordered = await run(short, h, () => {
        lineOf(folder, 1, short, `${cutBlock}\n\n${NOT_SAVED}`);
        lineOf(folder, 2, short, fullBlock);
      }, { resumeSessionId: sid });
      expect(ordered.message).toMatch(HEDGED);
      // An attached file that quotes grok's phrase for attached lines, a cut query, grok's note naming the query's lines.
      const quotesPhrase = fullBlock.replace('\n\n</attached_files>',
        '\n\n<file_contents path="/proj/doc.md" isFullFile="true">\n1→grok names attached context lines when it cuts them\n'
        + '</file_contents>\n\n</attached_files>');
      const phrase = `Use @tags.txt and @doc.md.\n${promptNo(95)}`;
      const quoted = await minted(phrase, `${quotesPhrase}\n\n${offloadedNote('p')}`, { cutQuery: true, file: true });
      expect(quoted.message).toContain('요청에 앞부분과 끝부분만 넣고 빠진 줄은 그 파일에서 읽으라고');
      expect(quoted.message).not.toContain('붙인 파일의 뒷부분');
      // An @ that attaches nothing (a Java annotation) and a reminder ahead of the note: no files are named.
      const annotated = `@Override public String toString() { return "x"; }\n${promptNo(96)}`;
      const javaReminder = '\n\n<system-reminder>\nThe todo list is empty.\n</system-reminder>';
      const java = await minted(annotated, `${javaReminder}\n\n${NOT_SAVED}`, { cutQuery: true });
      expect(java.message).toContain('프롬프트의 가운데는 모델에 닿지 않았습니다');
      expect(java.message).not.toContain('붙인 파일');
      // A mark after a single line break is read; a reminder later in what follows does not make text there no note.
      const single = await minted(promptNo(97), `\n${NOT_SAVED}`, { cutQuery: true });
      expect(single.message).toContain('프롬프트의 가운데는 모델에 닿지 않았습니다');
      const later = await minted(promptNo(98), `\n\n[A later grok says it in other words.]${javaReminder}`, { cutQuery: true });
      expect(later.message).toMatch(HEDGED);
      // A reminder that opens after a CR or a TAB, or with no line break after its tag, still opens the block.
      const opening = '<system-reminder>';
      for (const after of [`\r${fullBlock}`, `\t${fullBlock}`, fullBlock.replace(`${opening}\n`, opening)]) {
        const opened = await minted(short, after);
        expect(opened.message ?? '', JSON.stringify(after.slice(0, 24))).not.toMatch(SILENT);
      }
    }, 30_000);

    // Review round 12: round 11's rules against the nearest rule each is not — the files' tag only before the note, for
    // the file note as for the not-saved one, and only for a prompt that may mention a file; the order rule only without
    // a listing, the minted folder included, whatever note a cut turn carries — and two guards: only a user line is a
    // turn, and a whole query as long as the prompt but different inside is another prompt's.
    it('round 11\'s rules hold against their near variants, and only this prompt\'s user lines count', async () => {
      const todo = '\n\n<system-reminder>\nThe todo list is empty.\n</system-reminder>';
      // A tag in a reminder after the not-saved note names no files: the query is whole, so "part of the request".
      const after = await minted(short, `${todo}\n\n${NOT_SAVED}\n\n<system-reminder>\n<attached_files>\n</system-reminder>`);
      expect(after.message).toContain('요청의 일부는 모델에 닿지 않았습니다');
      expect(after.message).not.toContain('붙인 파일의 뒷부분');
      // grok's file note naming attached lines with no tag before it (an @Override attaches nothing): the middle only.
      const annotated = `@Override public String toString() { return "x"; }\n${promptNo(105)}`;
      const both = offloadedNote('p')
        .replace('user query lines 945–961', 'user query lines 945–961; attached context lines 1061–1253');
      const untagged = await minted(annotated, `\n\n${both}`, { cutQuery: true, file: true });
      expect(untagged.message).toContain('요청에 앞부분과 끝부분만 넣고 빠진 줄은 그 파일에서 읽으라고');
      expect(untagged.message).not.toContain('붙인 파일');
      // A prompt with no @ can have no file attached: a reminder quoting the tag ahead of the note names none, with the
      // not-saved note or with grok's file note naming attached lines (the tag guard alone named them).
      const ide = '\n\n<system-reminder>\nOpen in the IDE: <attached_files> src/a.ts </attached_files>\n</system-reminder>';
      for (const [note, file] of [[NOT_SAVED, false], [attachedNote('p'), true]] as const) {
        const quoted = await minted(promptNo(107), `${ide}\n\n${note}`, { cutQuery: true, file });
        expect(quoted.message, note.slice(0, 30)).toMatch(/프롬프트의 가운데는|요청에 앞부분과 끝부분만 넣고/);
        expect(quoted.message, note.slice(0, 30)).not.toContain('붙인 파일');
      }
      // The minted folder is under a listing too: without line 0, a whole turn 2 does not silence this run's cut turn 1.
      const p = promptNo(106);
      const h = home();
      const joined = await run(p, h, (sid) => {
        lineOf(folderOf(h, sid), 1, p, `\n\n${NOT_SAVED}`, true);
        lineOf(folderOf(h, sid), 2, p, '');
      });
      expect(joined.message).toMatch(HEDGED);
      // Under a listing a cut turn keeps a whole one from silencing whatever its note says: a reworded note.
      const h2 = home();
      const sid2 = 'a59-reworded-then-whole';
      const folder2 = folderOf(h2, sid2);
      lineOf(folder2, 0, 'A59L000001|seed', '');
      const reworded = await run(p, h2, () => {
        lineOf(folder2, 1, p, '\n\n[A later grok says it in other words.]', true);
        lineOf(folder2, 2, p, '');
      }, { resumeSessionId: sid2 });
      expect(reworded.message).toMatch(HEDGED);
      // An assistant line that quotes the query with the not-saved note and carries a prompt_index is no turn.
      const h3 = home();
      const quoting = await run(short, h3, (sid) => {
        const folder3 = folderOf(h3, sid);
        lineOf(folder3, 0, short, fullBlock);
        appendFileSync(join(folder3, 'chat_history.jsonl'), `${JSON.stringify({ type: 'assistant', prompt_index: 0,
          content: [{ type: 'text', text: `<user_query>\n${recorded(short, false)}\n</user_query>${cutBlock}\n\n${NOT_SAVED}` }] })}\n`);
      });
      expect(quoting.message ?? '').not.toMatch(SILENT);
      // A whole query as long as this prompt but different inside — another run's templated prompt given the same
      // number, recorded after this run's turn — is not this prompt: this run's own turn says what grok left out.
      const h4 = home();
      const sid4 = 'a59-same-length';
      const folder4 = folderOf(h4, sid4);
      lineOf(folder4, 0, 'A59L000001|seed', '');
      const template = (v: string) => `Review @tags.txt and @f1.txt.\n${'x'.repeat(1_200)}${v}${'y'.repeat(1_200)}`;
      const lookAlike = await run(template('A'), h4, () => {
        fileOf(folder4, 1, template('A'));
        lineOf(folder4, 1, template('A'), `${cutBlock}\n\n${attachedNote('p')}`);
        lineOf(folder4, 1, template('B'), fullBlock);
      }, { resumeSessionId: sid4 });
      expect(lookAlike.message).toMatch(ATTRIBUTED);
      expect(lookAlike.message).toContain('요청에서 @로 붙인 파일의 뒷부분을 빼고');
    }, 30_000);

    // Review round 13 (measured on 1.0.52 through the bundle): grok skips White_Space between the @ and the name, so
    // "@ f1.txt" and an @ before a line break attached the file. The mention guard missed them, and with it the end of the
    // files grok cut — under the boundary nothing was looked at, over it only the prompt's middle was named (round 12).
    it('an @ followed by white space mentions a file: the files grok cut are named, under the boundary and over it', async () => {
      for (const spelled of ['Review @ tags.txt and @ f1.txt and summarise them.', 'Review @\ntags.txt and @\r\nf1.txt.']) {
        const pointed = await minted(spelled, `${cutBlock}\n\n${attachedNote('p')}`, { file: true });
        expect(pointed.message, JSON.stringify(spelled)).toMatch(/^프롬프트\([\d,]+바이트\)와 @로 붙인 파일이 길어/);
        expect(pointed.message, JSON.stringify(spelled)).toContain('요청에서 @로 붙인 파일의 뒷부분을 빼고 빠진 줄은 저장한 파일에서');
      }
      const long = `Use @ tags.txt and @${String.fromCharCode(0xa0)}f1.txt.\n${promptNo(108)}`;
      const both = offloadedNote('p').replace('user query lines 945–961', 'user query lines 717–935; attached context lines 1226–1674');
      const named = await minted(long, `${cutBlock}\n\n${both}`, { cutQuery: true, file: true });
      expect(named.message).toContain('요청에 프롬프트의 앞부분과 끝부분만 넣고 @로 붙인 파일의 뒷부분은 빼고');
    });

    /**
     * grok's block for a skill the prompt invokes as `/bigskill …` (MEASURED on 1.0.52, review round 13): the skill's
     * text, and the rest of the prompt twice — as its arguments and after "**ARGUMENTS:**" — none of it numbered.
     */
    const skillBlock = (prompt: string, text = 'Summarise the repository in a fixed format.') => {
      const args = kept(prompt).replace(/^\/bigskill ?/, '');
      return '\n<skill_information>\n<skills_referenced>\n<skill name="bigskill" path="/home/u/.grok/skills/bigskill/SKILL.md"/>\n'
        + `</skills_referenced>\n<skill name="bigskill" args="${args}">\n# Big skill\n\n${text}\n\n**ARGUMENTS:** ${args}\n</skill>\n`
        + '</skill_information>';
    };
    /** grok's file note where it cut the skill's block — its middle; the block keeps its end (MEASURED on 1.0.52). */
    const skillNote = (path: string) => offloadedNote(path)
      .replace('user query lines 945–961', 'skill instructions lines 1058–1088').replace('offset=945, limit=17', 'offset=1058, limit=31');
    /** This run's turn 0 of a prompt that invoked the skill: the query, the skill's block, then `after`. */
    const skilled = (prompt: string, after: string, { cutQuery = false, file = false, text = undefined as string | undefined } = {}) => {
      const h = home();
      return run(prompt, h, (sid) => {
        const folder = folderOf(h, sid);
        if (file) {
          mkdirSync(join(folder, 'prompts'), { recursive: true });
          writeFileSync(join(folder, 'prompts', 'prompt_0.txt'),
            `<user_query>\n${kept(prompt)}\n</user_query>${skillBlock(prompt, text)}${prompt.includes('@') ? fullBlock : ''}`);
        }
        lineOf(folder, 0, prompt, `${skillBlock(prompt, text)}${after}`, cutQuery);
      });
    };

    // Review round 13 (measured on 1.0.52, through the bundle as well): a skill the prompt invokes as `/name` follows the
    // query in its own block, which repeats the prompt twice — grok cut 35 bytes with a 120 KB skill and 52 KB with a 3 KB
    // one — and keeps that block's end where it cuts its middle. Read as text after the query, the block made every uncut
    // skill turn a cut one (the hedge on a prompt with an @), and nothing looked at a short prompt grok cut by its skill.
    it('a skill the prompt invokes is read past its block, looked at whatever its size, and named in the sentence', async () => {
      const plain = '/bigskill summarise this repository';
      const mentioning = '/bigskill review @tags.txt and @f1.txt briefly';
      // Kept whole: nothing, with an @-mention or without one, and after a later trailer that holds no known mark.
      expect((await skilled(plain, '')).message ?? '').not.toMatch(SILENT);
      expect((await skilled(mentioning, fullBlock)).message ?? '').not.toMatch(SILENT);
      expect((await skilled(plain, '\n\n[A later grok says it in other words.]')).message ?? '').not.toMatch(SILENT);
      // A short prompt grok cut by its skill: looked at, the skill named with the prompt, the left-out part unnamed.
      const cut = await skilled(plain, `\n\n${skillNote('p')}`, { file: true });
      expect(cut.message).toMatch(/^프롬프트\([\d,]+바이트\)와 \/로 부른 스킬이 길어 grok이 전문을 .*prompt_0\.txt에 따로 저장했습니다/);
      expect(cut.message).toContain('요청을 줄이고 빠진 줄은 그 파일에서 읽으라고');
      // Where grok could not save the file: what it left out did not reach the model, and the advice is about the skill.
      const lost = await skilled(plain, `\n\n${NOT_SAVED}`);
      expect(lost.message).toContain('요청의 일부는 모델에 닿지 않았습니다. 프롬프트나 /로 부른 스킬을 줄이거나, 그 스킬 없이 다시 실행하세요.');
      // A long prompt whose query grok cut too; a short one whose attached files it cut after the skill's block; an @ that
      // attached nothing, which the subject does not name where the turn shows no attached files.
      const long = `/bigskill ${promptNo(109)}`;
      const both = offloadedNote('p').replace('user query lines 945–961', 'user query lines 716–967; skill instructions lines 1198–3018');
      const longCut = await skilled(long, `\n\n${both}`, { cutQuery: true, file: true });
      expect(longCut.message).toMatch(/^프롬프트\([\d,]+바이트\)와 \/로 부른 스킬이 길어/);
      expect(longCut.message).toContain('요청에 앞부분과 끝부분만 넣고 빠진 줄은 그 파일에서 읽으라고');
      const filesCut = await skilled(mentioning, `${cutBlock}\n\n${attachedNote('p')}`, { file: true });
      expect(filesCut.message).toMatch(/^프롬프트\([\d,]+바이트\)와 \/로 부른 스킬, @로 붙인 파일이 길어/);
      expect(filesCut.message).toContain('요청에서 @로 붙인 파일의 뒷부분을 빼고 빠진 줄은 저장한 파일에서');
      const annotated = await skilled('/bigskill review @Override in Foo.java', `\n\n${skillNote('p')}`, { file: true });
      expect(annotated.message).toMatch(/^프롬프트\([\d,]+바이트\)와 \/로 부른 스킬이 길어/);
      // Files attached whole while grok cut the skill's block: both named as long, neither the prompt nor the files cut.
      const skillOnly = await skilled(mentioning, `${fullBlock}\n\n${skillNote('p')}`, { file: true });
      expect(skillOnly.message).toMatch(/^프롬프트\([\d,]+바이트\)와 \/로 부른 스킬, @로 붙인 파일이 길어/);
      expect(skillOnly.message).toContain('요청을 줄이고 빠진 줄은 그 파일에서 읽으라고');
      // grok runs `/name` as a skill only at the trimmed start (measured): after leading spaces or a U+FEFF it is looked
      // at; after other words it is not, and a planted cut turn decides nothing there.
      for (const lead of ['   ', String.fromCharCode(0xfeff)]) {
        const led = await skilled(`${lead}${plain}`, `\n\n${skillNote('p')}`, { file: true });
        expect(led.message, JSON.stringify(lead)).toMatch(POINTED);
      }
      expect((await minted(`Please run ${plain}`, `\n\n${offloadedNote('p')}`, { file: true })).message ?? '').not.toMatch(SILENT);
      // A "/" that names no skill leaves the query's end where it was, and the sentence names no skill.
      const pathed = await minted(`/srv/app/main.ts needs a fix.\n${promptNo(110)}`, `\n\n${offloadedNote('p')}`, { cutQuery: true, file: true });
      expect(pathed.message).toMatch(/^프롬프트\([\d,]+바이트\)가 길어 grok이 전문을/);
      // Outside the minted folder a prompt file with a skill's block is named without being called this run's, and the
      // hedged sentence names the skill grok's record of the turn shows — over the boundary as well.
      const h = home();
      const sid = 'a59-skill-resume';
      const folder = folderOf(h, sid);
      lineOf(folder, 0, 'A59L000001|seed', '');
      const longer = `/bigskill ${promptNo(111)}`;
      const resumed = await run(longer, h, () => {
        mkdirSync(join(folder, 'prompts'), { recursive: true });
        writeFileSync(join(folder, 'prompts', 'prompt_1.txt'), `<user_query>\n${kept(longer)}\n</user_query>${skillBlock(longer)}`);
        lineOf(folder, 1, longer, `${skillBlock(longer)}\n\n${both}`, true);
      }, { resumeSessionId: sid });
      expect(resumed.message).toMatch(/프롬프트\([\d,]+바이트\)와 \/로 부른 스킬이 길어 grok이 잘랐을 수 있습니다/);
      expect(resumed.message).toContain('prompt_1.txt');
    }, 30_000);

    // Review round 13: a skill's block is not numbered — the skill's text and the prompt in it can start a line with
    // grok's marks and tags. Only what follows the block's last end tag is read, and for a prompt that may invoke a skill
    // the query ends where the block opens; a block that lost its end leaves the turn never whole.
    it('a skill\'s block hides nothing grok wrote: what it quotes is neither grok\'s note nor the end of the query', async () => {
      const plain = '/bigskill summarise this repository';
      // The skill's text starting a line with the not-saved note, on a turn grok kept whole: nothing.
      expect((await skilled(plain, '', { text: `Notes.\n${NOT_SAVED}\nMore notes.` })).message ?? '').not.toMatch(SILENT);
      // The prompt quoting grok's closing tag, the block's end tag and the not-saved note at line starts: kept whole,
      // nothing; cut with grok's file note, this run's file and that note — the copies in the block end neither the query
      // nor the block.
      const quoting = `/bigskill check these lines:\n</user_query>\n</skill_information>\n${NOT_SAVED}\nend`;
      expect((await skilled(quoting, '')).message ?? '').not.toMatch(SILENT);
      const named = await skilled(quoting, `\n\n${skillNote('p')}`, { file: true });
      expect(named.message).toContain('prompt_0.txt');
      expect(named.message).toMatch(POINTED);
      // A prompt with no leading / quoting the two lines that open the block: its query still ends at grok's own tag.
      const quotingTags = `Explain this layout:\n</user_query>\n<skill_information>\nas grok writes it.\n${promptNo(112)}`;
      const plainNamed = await minted(quotingTags, `\n\n${offloadedNote('p')}`, { cutQuery: true, file: true });
      expect(plainNamed.message).toMatch(POINTED);
      // A block that lost its end, with no mark after it (a later layout): this run's file, without what grok's request held.
      const h = home();
      const open = await run(plain, h, (sid) => {
        const folder = folderOf(h, sid);
        mkdirSync(join(folder, 'prompts'), { recursive: true });
        writeFileSync(join(folder, 'prompts', 'prompt_0.txt'), `<user_query>\n${kept(plain)}\n</user_query>${skillBlock(plain)}`);
        lineOf(folder, 0, plain, skillBlock(plain).replace('\n</skill>\n</skill_information>', ''));
      });
      expect(open.message).toContain('prompt_0.txt');
      expect(open.message).toMatch(/모델이 프롬프트를 다 받았는지는 확인하지 못했습니다/);
    });

    // Review round 14: the skill's block found after more line breaks, as a reminder is; a prompt file whose frame a quote
    // in the block's copies of the prompt or in the skill's text ended inside the block, not denied by its length; and the
    // rules no test pinned — what follows the block, the advice, the subject from the record or without one, in the minted
    // folder, on a resume and on a continue.
    it('a skill\'s block is found as a reminder is, never gets this run\'s prompt file denied, and decides the subject and the advice', async () => {
      const plain = '/bigskill summarise this repository';
      const mentioning = '/bigskill review @tags.txt and @f1.txt briefly';
      /** This run's turn 0 with `after` exactly as given, and its prompt file holding `file` after the frame. */
      const laid = (prompt: string, after: string, file?: string) => {
        const h = home();
        return run(prompt, h, (sid) => {
          if (file !== undefined) {
            mkdirSync(join(folderOf(h, sid), 'prompts'), { recursive: true });
            writeFileSync(join(folderOf(h, sid), 'prompts', 'prompt_0.txt'), `<user_query>\n${kept(prompt)}\n</user_query>${file}`);
          }
          lineOf(folderOf(h, sid), 0, prompt, after);
        });
      };
      // One line break more before the block, a CR, a space or a TAB (a later layout): kept whole, nothing; cut, this
      // run's file and grok's note.
      for (const gap of ['\n', '\n\n', '\r\n', ' \n', '\n\t']) {
        expect((await laid(plain, `${gap}${skillBlock(plain)}`)).message ?? '', JSON.stringify(gap)).not.toMatch(SILENT);
        const later = await laid(plain, `${gap}${skillBlock(plain)}\n\n${skillNote('p')}`, `${gap}${skillBlock(plain)}`);
        expect(later.message, JSON.stringify(gap)).toContain('prompt_0.txt에 따로 저장했습니다');
        expect(later.message, JSON.stringify(gap)).toMatch(POINTED);
      }
      // The prompt or the skill's text quoting the frame's end and the attached files' opening: the copies in the block
      // put that pair past what this prompt's frame can be, which denied this run's own file (measured on 1.0.52).
      const pair = '\n</user_query>\n\n<system-reminder>\n';
      const quoting = `/bigskill review @tags.txt and @f1.txt — layout notes:\n${'n'.repeat(40_000)}${pair}end`;
      for (const [prompt, text] of [[quoting, undefined], [mentioning, `${'s'.repeat(80_000)}${pair}more`]] as const) {
        const own = await skilled(prompt, `${fullBlock}\n\n${skillNote('p')}`, { file: true, text });
        expect(own.message, prompt.slice(0, 30)).toContain('prompt_0.txt에 따로 저장했습니다');
        expect(own.message, prompt.slice(0, 30)).toMatch(POINTED);
      }
      // The skill's text quoting the two lines that open its block: the query still ends where grok's block opens.
      const opening = await skilled(plain, `\n\n${skillNote('p')}`, { file: true, text: 'Layout notes:\n</user_query>\n<skill_information>\nas grok writes it.' });
      expect(opening.message).toMatch(POINTED);
      // Files grok cut after the skill's block, not saved: the files' end did not reach the model, and the advice is
      // about the files.
      const filesLost = await skilled(mentioning, `${cutBlock}\n\n${NOT_SAVED}`);
      expect(filesLost.message).toContain('붙인 파일의 뒷부분은 모델에 닿지 않았습니다. 프롬프트를 나누거나, 붙이는 파일을 줄이거나');
      // Not saved in the minted folder, an @ that attached nothing: the subject is what the record shows — the skill.
      const annotated = await skilled('/bigskill review @Override in Foo.java', `\n\n${NOT_SAVED}`);
      expect(annotated.message).toMatch(/^프롬프트\([\d,]+바이트\)와 \/로 부른 스킬이 길어/);
      // Under the boundary, a record that shows neither block, and no record at all: what the prompt may have added — the
      // skill, and the files as well where it may mention one.
      const unshown = await minted(plain, `\n\n${skillNote('p')}`, { file: true });
      expect(unshown.message).toMatch(/^프롬프트\([\d,]+바이트\)와 \/로 부른 스킬이 길어/);
      const neither = await laid(mentioning, `\n\n${offloadedNote('p')}`, `${skillBlock(mentioning)}${fullBlock}`);
      expect(neither.message).toMatch(/^프롬프트\([\d,]+바이트\)와 \/로 부른 스킬, @로 붙인 파일이 길어/);
      const h = home();
      const unrecorded = await run(mentioning, h, (sid) => {
        mkdirSync(join(folderOf(h, sid), 'prompts'), { recursive: true });
        writeFileSync(join(folderOf(h, sid), 'prompts', 'prompt_0.txt'), `<user_query>\n${kept(mentioning)}\n</user_query>${skillBlock(mentioning)}${fullBlock}`);
      });
      expect(unrecorded.message).toMatch(/^프롬프트\([\d,]+바이트\)와 \/로 부른 스킬, @로 붙인 파일이 길어/);
      // Over the boundary with no record, the prompt alone: it was long enough without what grok added.
      const big = `/bigskill ${promptNo(113)}`;
      const h2 = home();
      const bigAlone = await run(big, h2, (sid) => {
        mkdirSync(join(folderOf(h2, sid), 'prompts'), { recursive: true });
        writeFileSync(join(folderOf(h2, sid), 'prompts', 'prompt_0.txt'), `<user_query>\n${kept(big)}\n</user_query>${skillBlock(big)}`);
      });
      expect(bigAlone.message).toContain('prompt_0.txt');
      expect(bigAlone.message).toMatch(/^프롬프트\([\d,]+바이트\)가 길어/);
      // A resume whose record shows both blocks, the skill's cut, and a continue with no line of this run: the hedged
      // sentence names both, from the record and from what the prompt may have added.
      const h3 = home();
      const sid3 = 'a59-skill-files-resume';
      const folder3 = folderOf(h3, sid3);
      lineOf(folder3, 0, 'A59L000001|seed', '');
      const resumed = await run(mentioning, h3, () => {
        mkdirSync(join(folder3, 'prompts'), { recursive: true });
        writeFileSync(join(folder3, 'prompts', 'prompt_1.txt'), `<user_query>\n${kept(mentioning)}\n</user_query>${skillBlock(mentioning)}${fullBlock}`);
        lineOf(folder3, 1, mentioning, `${skillBlock(mentioning)}${fullBlock}\n\n${skillNote('p')}`);
      }, { resumeSessionId: sid3 });
      expect(resumed.message).toMatch(/ 프롬프트\([\d,]+바이트\)와 \/로 부른 스킬, @로 붙인 파일이 길어 grok이 잘랐을 수 있습니다/);
      const h4 = home();
      const folder4 = folderOf(h4, 'continued-session');
      lineOf(folder4, 0, 'A59L000001|seed', '');
      const continued = await run(mentioning, h4, () => {
        mkdirSync(join(folder4, 'prompts'), { recursive: true });
        writeFileSync(join(folder4, 'prompts', 'prompt_1.txt'), `<user_query>\n${kept(mentioning)}\n</user_query>${skillBlock(mentioning)}${fullBlock}`);
      }, { continueSession: true });
      expect(continued.message).toMatch(/ 프롬프트\([\d,]+바이트\)와 \/로 부른 스킬, @로 붙인 파일이 길어 grok이 잘랐을 수 있습니다/);
      // A prompt grok added no block to, quoting those two lines — one with no leading /, and one that starts with a path,
      // the quote in the middle grok leaves out: its file is still compared, and a resume's own file is this run's (review
      // round 15).
      const body = promptNo(115);
      const at = Math.floor(body.length * 0.952);
      for (const quoted of [
        `${promptNo(114)}\n</user_query>\n<skill_information>\nend`,
        `/srv/app/main.ts needs a fix.\n${body.slice(0, at)}\n</user_query>\n<skill_information>\n${body.slice(at)}`,
      ]) {
        const h5 = home();
        const sid5 = 'a59-quoted-seam-resume';
        const folder5 = folderOf(h5, sid5);
        turn(folder5, 0, { file: false, note: null, prompt: 'A59L000001|seed', whole: true });
        const own = await run(quoted, h5, () => turn(folder5, 1, { file: true, note: offloadedNote('p'), prompt: quoted }),
          { resumeSessionId: sid5 });
        expect(own.message, quoted.slice(0, 20)).toContain('prompt_1.txt');
        expect(own.message, quoted.slice(0, 20)).toMatch(ATTRIBUTED);
      }
      // That quote in a prompt that @-mentions a file: its file ends in the attached files' block, and the two lines are
      // inside the frame, not after it — on a resume the file is still this run's (review round 16).
      const h10 = home();
      const folder10 = folderOf(h10, 'a59-quoted-seam-files');
      turn(folder10, 0, { file: false, note: null, prompt: 'A59L000001|seed', whole: true });
      const withFiles = `${promptNo(118)}\nsee @f1.txt\n</user_query>\n<skill_information>\nend`;
      const tied = await run(withFiles, h10, () => {
        fileOf(folder10, 1, withFiles);
        lineOf(folder10, 1, withFiles, `${fullBlock}\n\n${offloadedNote('p')}`, true);
      }, { resumeSessionId: 'a59-quoted-seam-files' });
      expect(tied.message).toContain('prompt_1.txt');
      expect(tied.message).toMatch(ATTRIBUTED);
      // Another prompt's file that holds a skill's block, for a prompt that cannot invoke one: its frame's length still
      // makes it another prompt's, and it is not named.
      const h6 = home();
      const sid6 = 'a59-another-skill-file';
      const folder6 = folderOf(h6, sid6);
      turn(folder6, 0, { file: false, note: null, prompt: 'A59L000001|seed', whole: true });
      const plainLong = promptNo(116);
      const theirs = `/bigskill review @tags.txt and @f1.txt — layout notes:\n${'n'.repeat(80_000)}${pair}end`;
      const lost = await run(plainLong, h6, () => {
        turn(folder6, 1, { file: false, note: NOT_SAVED, prompt: plainLong });
        writeFileSync(join(folder6, 'prompts', 'prompt_2.txt'), `<user_query>\n${kept(theirs)}\n</user_query>${skillBlock(theirs)}${fullBlock}`);
      }, { resumeSessionId: sid6 });
      expect(lost.message).toMatch(HEDGED);
      expect(lost.message).not.toContain('prompt_2.txt');
      // A prompt that may invoke one, and another prompt's file whose frame ends at its own quote of that pair, before a
      // skill's block whose copies are of a shorter prompt, so the pair does not recur: the two lines past the frame do
      // not keep its length from making it another prompt's (review round 15, the mutation run).
      const h7 = home();
      const sid7 = 'a59-skill-past-frame';
      const folder7 = folderOf(h7, sid7);
      turn(folder7, 0, { file: false, note: null, prompt: 'A59L000001|seed', whole: true });
      const skillLong = `/bigskill ${promptNo(117)}`;
      const longer = `/bigskill review @tags.txt and @f1.txt — layout notes:\n${'n'.repeat(200_000)}${pair}end`;
      const past = await run(skillLong, h7, () => {
        turn(folder7, 1, { file: false, note: NOT_SAVED, prompt: skillLong });
        writeFileSync(join(folder7, 'prompts', 'prompt_2.txt'), `<user_query>\n${kept(longer)}\n</user_query>${skillBlock(plain)}${fullBlock}`);
      }, { resumeSessionId: sid7 });
      expect(past.message).toMatch(HEDGED);
      expect(past.message).not.toContain('prompt_2.txt');
      // That frame with a quoted end tag, and the block's opening line quoted after other text: neither is the two lines,
      // so its length still makes it another prompt's (review round 16).
      const h8 = home();
      const folder8 = folderOf(h8, 'a59-skill-one-line');
      turn(folder8, 0, { file: false, note: null, prompt: 'A59L000001|seed', whole: true });
      const halves = `/bigskill review @tags.txt and @f1.txt — layout notes:\n${'n'.repeat(100_000)}\n</user_query>\nquoted end tag\n`
        + `<skill_information>\nquoted opening\n${'n'.repeat(100_000)}${pair}end`;
      const half = await run(skillLong, h8, () => {
        turn(folder8, 1, { file: false, note: NOT_SAVED, prompt: skillLong });
        writeFileSync(join(folder8, 'prompts', 'prompt_2.txt'), `<user_query>\n${kept(halves)}\n</user_query>${skillBlock(plain)}${fullBlock}`);
      }, { resumeSessionId: 'a59-skill-one-line' });
      expect(half.message).toMatch(HEDGED);
      expect(half.message).not.toContain('prompt_2.txt');
      // A block whose copies hold no part of that pair (a later layout's; here they copy only `/bigskill`'s arguments, the
      // wrapper's suffix): another prompt that begins with this one and quotes the pair is cut there, its frame then
      // exactly this prompt's. The two lines that open its block follow that frame, so the
      // file is not tied to this run — with no turn of this run, the hedged sentence; with a whole one, nothing (review
      // round 16).
      const bare = '/bigskill review @f1.txt briefly';
      for (const whole of [false, true]) {
        const h9 = home();
        const folder9 = folderOf(h9, 'a59-skill-frame-prefix');
        turn(folder9, 0, { file: false, note: null, prompt: 'A59L000001|seed', whole: true });
        const prefixed = await run(bare, h9, () => {
          if (whole) turn(folder9, 1, { file: false, note: null, prompt: bare, whole: true });
          writeFileSync(join(folder9, 'prompts', 'prompt_2.txt'),
            `<user_query>\n${kept(bare)}${pair}more\n</user_query>${skillBlock('/bigskill')}${fullBlock}`);
        }, { resumeSessionId: 'a59-skill-frame-prefix' });
        if (whole) expect(prefixed.message ?? '', 'whole').not.toMatch(SILENT);
        else expect(prefixed.message, 'no turn').toMatch(HEDGED);
      }
      // In 1.0.52's layout, another prompt that quotes that pair and then the two lines: its frame is cut at the block's
      // last copy of the pair, the two lines follow it, and the frame is not this prompt's — still another prompt's, not
      // named (review round 17: the two lines decide only for a frame of exactly this prompt).
      const h11 = home();
      const folder11 = folderOf(h11, 'a59-skill-frame-other');
      turn(folder11, 0, { file: false, note: null, prompt: 'A59L000001|seed', whole: true });
      const other = `/bigskill other task for @f1.txt ${'q'.repeat(40_000)}${pair}y\n</user_query>\n<skill_information>\nz`;
      const notTied = await run(skillLong, h11, () => {
        turn(folder11, 1, { file: false, note: NOT_SAVED, prompt: skillLong });
        writeFileSync(join(folder11, 'prompts', 'prompt_2.txt'), `<user_query>\n${kept(other)}\n</user_query>${skillBlock(other)}${fullBlock}`);
      }, { resumeSessionId: 'a59-skill-frame-other' });
      expect(notTied.message).toMatch(HEDGED);
      expect(notTied.message).not.toContain('prompt_2.txt');
    }, 30_000);
  });

  // Review round 6: only a cut turn without a file keeps the one file from being this run's — one recorded whole does not.
  it('a turn of this prompt recorded whole elsewhere does not stop this run\'s file being named', async () => {
    const h = home();
    const folder = folderOf(h, 'continued-session');
    const p = promptNo(73);
    const r = await run(p, h, () => {
      turn(folder, 1, { file: false, note: null, prompt: p, whole: true });
      turn(folder, 2, { file: true, note: offloadedNote('p'), prompt: p });
    }, { continueSession: true });
    expect(r.message).toContain('prompt_2.txt');
    expect(r.message).toMatch(POINTED);
  });

  it('a prompt file that is a link is not grok\'s file', async (ctx) => {
    const h = home();
    const p = promptNo(57);
    const target = join(h, 'elsewhere.txt');
    writeFileSync(target, `<user_query>\n${kept(p)}\n</user_query>`);
    let linked = true;
    const r = await run(p, h, (sid) => {
      mkdirSync(join(folderOf(h, sid), 'prompts'), { recursive: true });
      try { symlinkSync(target, join(folderOf(h, sid), 'prompts', 'prompt_0.txt')); } catch { linked = false; }
    });
    if (!linked) ctx.skip(); // win32 without the privilege
    expect(r.message ?? '').not.toMatch(SILENT);
  });

  it('a file longer than this prompt\'s can be is another prompt\'s only with both ends of grok\'s frame', async () => {
    const h = home();
    const folder = folderOf(h, 'continued-session');
    const p = promptNo(58);
    const pad = 'z'.repeat(70 * 1024);
    const headOnly = await run(p, h, () => {
      mkdirSync(join(folder, 'prompts'), { recursive: true });
      writeFileSync(join(folder, 'prompts', 'prompt_1.txt'), `<user_query>\n${kept(p)}${pad}`);
    }, { continueSession: true });
    expect(headOnly.message).toContain('prompt_1.txt');
    expect(headOnly.message).toMatch(HEDGED);
    setTime(join(folder, 'prompts', 'prompt_1.txt'), -30_000);
    const tailOnly = await run(p, h, () => writeFileSync(join(folder, 'prompts', 'prompt_2.txt'), `${pad}${kept(p)}\n</user_query>`),
      { continueSession: true });
    expect(tailOnly.message).toContain('prompt_2.txt');
    expect(tailOnly.message).toMatch(HEDGED);
  });

  // DROP_LENGTH (Grok, round 2): on the not-saved path the history names no path, so a length would be the wrapper's own
  // join — not grok's path for a \\?\ home, a `.` segment or an 8.3 name. And no grok version is named: the sentence
  // speaks of this run's record, which stays true whatever a later grok does.
  it('the sentences state this run\'s facts only — no path length, no grok version', () => {
    const file = 'C:\\h\\sessions\\C%3A%5Cproj\\sid\\prompts\\prompt_0.txt';
    const second = file.replace('prompt_0', 'prompt_1');
    for (const [files, told] of [[[file], 'not_saved'], [[file], 'file'], [[file], 'unknown'], [[file, second], 'unattributed'],
      [[], 'not_saved'], [[], 'unattributed']] as const) {
      const s = offloadNote(100_500, files, told);
      expect(s).toContain('100,500');
      for (const f of files) expect(s).toContain(f);
      expect(s).not.toMatch(/\d자/);
      expect(s).not.toMatch(/1\.0\.\d/);
    }
    const hedged = offloadNote(100_500, [file, second], 'unattributed');
    expect(hedged).toMatch(HEDGED);
    expect(hedged).not.toMatch(CLAIMS);
    expect(hedged).not.toMatch(ATTRIBUTED);
    expect(offloadNote(100_500, [], 'not_saved')).toMatch(STRONG);
    const noFile = offloadNote(100_500, [], 'unattributed');
    expect(noFile).toMatch(HEDGED);
    expect(noFile).not.toMatch(CLAIMS);
    expect(noFile).not.toMatch(ATTRIBUTED);
    // Review round 7: grok's record says what it put in its request — a request refused or never answered is recorded
    // the same way, and a refused session on 1.0.52 never sent one — so no sentence says grok sent or told the model.
    for (const [files, told] of [[[file], 'not_saved'], [[file], 'file'], [[], 'not_saved']] as const) {
      const s = offloadNote(100_500, files, told);
      expect(s).toContain('모델에 보낼 요청에 앞부분과 끝부분만');
    }
    for (const [files, told] of [[[file], 'not_saved'], [[file], 'file'], [[file], 'unknown'], [[file, second], 'unattributed'],
      [[], 'not_saved'], [[], 'unattributed']] as const) {
      expect(offloadNote(100_500, files, told)).not.toMatch(/보냈|알렸/);
      expect(offloadNote(100_500, files, told)).toMatch(/^프롬프트\(100,500바이트\)가 길어 grok이 /);
      // Under 99,977 bytes only the files an @-mention attached can have taken grok's count over it.
      expect(offloadNote(99_000, files, told)).toMatch(/^프롬프트\(99,000바이트\)와 @로 붙인 파일이 길어 grok이 /);
    }
    expect(offloadNote(99_977, [file], 'file')).toMatch(/^프롬프트\(99,977바이트\)가 길어/);
    expect(offloadNote(99_976, [file], 'file')).toMatch(/^프롬프트\(99,976바이트\)와 @로 붙인 파일이 길어/);
    // Review round 13: what grok added is named with the prompt — a skill's block, the attached files, both or neither —
    // and where only the skill's block can explain the cut, the advice is about it.
    const neither = { prompt: false, files: false };
    expect(offloadNote(268, [file], 'file', neither, { files: false, skill: true })).toMatch(/^프롬프트\(268바이트\)와 \/로 부른 스킬이 길어 grok이 /);
    expect(offloadNote(297, [file], 'file', { prompt: false, files: true }, { files: true, skill: true }))
      .toMatch(/^프롬프트\(297바이트\)와 \/로 부른 스킬, @로 붙인 파일이 길어 grok이 /);
    expect(offloadNote(99_000, [file], 'file', neither, { files: false, skill: false })).toMatch(/^프롬프트\(99,000바이트\)가 길어/);
    expect(offloadNote(268, [], 'not_saved', neither, { files: false, skill: true })).toContain('. 프롬프트나 /로 부른 스킬을 줄이거나, 그 스킬 없이 다시 실행하세요.');
    expect(offloadNote(268, [], 'not_saved', { prompt: true, files: false }, { files: false, skill: true })).toContain('프롬프트를 나누거나');
    // Review round 8: what the record shows grok left out — the prompt's middle, the attached files' end, both, or neither
    // seen — is what the sentence names, and a cut of the files names them in the subject whatever the size.
    const lost = (cut: { prompt: boolean; files: boolean }, files: readonly string[] = [file]) =>
      offloadNote(100_500, files, 'not_saved', cut);
    expect(lost({ prompt: true, files: false })).toContain('프롬프트의 가운데는 모델에 닿지 않았습니다');
    expect(lost({ prompt: false, files: true })).toContain('붙인 파일의 뒷부분은 모델에 닿지 않았습니다');
    expect(lost({ prompt: true, files: true })).toContain('프롬프트의 가운데와 붙인 파일의 뒷부분은 모델에 닿지 않았습니다');
    expect(lost({ prompt: false, files: false })).toContain('요청의 일부는 모델에 닿지 않았습니다');
    expect(lost({ prompt: false, files: true }, [])).toContain('붙인 파일의 뒷부분은 모델에 닿지 않았습니다');
    for (const cut of [{ prompt: false, files: true }, { prompt: true, files: true }]) {
      expect(lost(cut)).toMatch(/^프롬프트\(100,500바이트\)와 @로 붙인 파일이 길어/);
      expect(lost(cut)).toContain('@ 없이 경로만 적어');
      expect(offloadNote(100_500, [file], 'file', cut)).toMatch(POINTED);
    }
    expect(lost({ prompt: true, files: false })).toMatch(/^프롬프트\(100,500바이트\)가 길어/);
    expect(lost({ prompt: true, files: false })).not.toContain('@ 없이');
    // Review round 9: after "@로 붙인 파일" a bare "그 파일" reads as the attached file — the saved one is named so.
    for (const cut of [{ prompt: false, files: true }, { prompt: true, files: true }]) {
      expect(offloadNote(100_500, [file], 'file', cut)).toContain('빠진 줄은 저장한 파일에서 읽으라고');
      expect(lost(cut)).toContain('저장한 파일은 넘기지 못했습니다');
    }
    expect(offloadNote(100_500, [file], 'file', { prompt: true, files: false })).toContain('빠진 줄은 그 파일에서 읽으라고');
    expect(lost({ prompt: true, files: false })).toContain('그 파일은 넘기지 못했습니다');
    expect(offloadNote(100_500, [file], 'file', { prompt: false, files: false })).toContain('요청을 줄이고 빠진 줄은');
    for (const cut of [{ prompt: true, files: false }, { prompt: false, files: true }, { prompt: true, files: true },
      { prompt: false, files: false }]) {
      for (const told of ['file', 'not_saved'] as const) expect(offloadNote(100_500, [file], told, cut)).not.toMatch(/보냈|알렸/);
    }
  });
});

// A41 (docs/10, MEASURED 2026-09-25): the call settled on 'close' — every holder of grok's stdout and
// stderr gone — not on grok's own exit. A descendant that kept those pipes held a 2 s cap open for 8.1 s
// and turned a clean exit into timedOut:true (reproduced with `start /b` by the reviewer and with a
// detached node grandchild by the audit). On win32 the cap kills grok alone, so a call could hang for as
// long as any grandchild lived.
describe('A41 — the call ends when grok does, whatever it left holding the pipes', () => {
  const grandchild = (holdMs: number, exitCode = 0) => "const { spawn } = require('node:child_process');"
    + ` spawn(process.execPath, ['-e', 'setTimeout(() => {}, ${holdMs})'], { stdio: 'inherit', detached: true }).unref();`
    + ` process.stdout.write('ENVELOPE', () => process.exit(${exitCode}));`;
  const pipes = () => process.getActiveResourcesInfo().filter((x) => x === 'PipeWrap').length;

  // A version that waited for the pipes runs into the 6 s cap (timed out) or the 9 s grandchild; the fix returns when
  // grok exits — 0.38 to 0.42 s on win32 (three runs), 3.2 s once at 0.1 CPU (round 18 of the v0.2.36 pre-merge review,
  // which found the 2.5 s bound this test had failing there once in 21 runs). The bound stays below the cap. And it lets
  // go of the pipes it stopped reading (round 19: a version that did not destroy them kept a server that made one such
  // call alive 9 s, not 2).
  it('a clean exit with a grandchild holding stdio returns promptly, not timed out, output intact', async () => {
    const before = pipes();
    const t0 = Date.now();
    const r = await spawnBounded(process.execPath, ['-e', grandchild(9000)], tmpdir(), process.env, 6000, 300);
    expect(r.timedOut).toBe(false);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('ENVELOPE');
    expect(Date.now() - t0).toBeLessThan(5000);
    // The read stopped while something still held the pipes: what it has may end mid-text (round 21 — a grok_cli run
    // whose background child was printing a key recorded 17 of 30 of it as the summary).
    expect(r.cutShort).toBe(true);
    // A destroyed pipe closes within a few turns (more than one, on win32 and Linux alike); a kept one stays for the
    // grandchild's 9 s.
    for (let i = 0; i < 50 && pipes() > before; i++) await new Promise((res) => setTimeout(res, 20));
    expect(pipes()).toBeLessThanOrEqual(before);
  }, 20_000);

  // Round 19 of the v0.2.36 pre-merge review: four more wrong versions passed every test — each row below is one.
  // A failing exit gets the same grace (one that started it only on exit 0 waited 10 s for the holder, the cap
  // already cleared).
  it('a failing exit with a grandchild holding stdio returns promptly too, with its code', async () => {
    const t0 = Date.now();
    const r = await spawnBounded(process.execPath, ['-e', grandchild(9000, 3)], tmpdir(), process.env, 6000, 300);
    expect(r.code).toBe(3);
    expect(r.timedOut).toBe(false);
    expect(Date.now() - t0).toBeLessThan(5000);
    // …and says its read stopped short too (round 22: a version that said so only on exit 0 passed every test, and let
    // a failing run's cut output back into history — 17 of 30).
    expect(r.cutShort).toBe(true);
  }, 20_000);

  // …and one holding only stdout makes it cut short (round 23: a version that read "either pipe ended" passed every
  // test and recorded 17 of 30 characters of a key the child was printing).
  it('a grandchild holding only stdout makes it cut short', async () => {
    const holdsStdout = "const { spawn } = require('node:child_process');"
      + " spawn(process.execPath, ['-e', 'setTimeout(() => {}, 9000)'], { stdio: ['ignore', 'inherit', 'ignore'], detached: true }).unref();"
      + " process.stdout.write('ENVELOPE', () => process.exit(0));";
    const r = await spawnBounded(process.execPath, ['-e', holdsStdout], tmpdir(), process.env, 6000, 300);
    expect(r.stdout).toBe('ENVELOPE');
    expect(r.cutShort).toBe(true);
  }, 20_000);

  // "Cut short" is about stdout: a grandchild that holds only stderr keeps the call to the grace, but stdout had already
  // ended, whole (round 22: the flag was set anyway, and a whole output lost its summary).
  it('a grandchild holding only stderr does not make stdout cut short', async () => {
    const holdsStderr = "const { spawn } = require('node:child_process');"
      + " spawn(process.execPath, ['-e', 'setTimeout(() => {}, 9000)'], { stdio: ['ignore', 'ignore', 'inherit'], detached: true }).unref();"
      + " process.stdout.write('ENVELOPE', () => process.exit(0));";
    const r = await spawnBounded(process.execPath, ['-e', holdsStderr], tmpdir(), process.env, 6000, 300);
    expect(r.stdout).toBe('ENVELOPE');
    expect(r.cutShort).toBeUndefined();
  }, 20_000);

  // An exit before the cap is not a timeout, even while the grace runs past the cap — a clean exit or a failing one (one
  // that left the cap running after the exit said timedOut:true, round 19; one that cleared it only on exit 0 did so for
  // exit 3, round 20). The cap sits far above the exit: round 20 saw exits near 4.9 s against a 5 s cap twice at 0.1 CPU
  // and one timeout in 41 runs at 0.1–0.15 CPU, with six containers running — so 8 s, and the grace 10 s. Both run at
  // once, so the test takes about 10 s.
  it('an exit before the cap is not a timeout, clean or failing, even when the grace outlasts the cap', async () => {
    const [clean, failing] = await Promise.all([0, 3].map((code) =>
      spawnBounded(process.execPath, ['-e', grandchild(16000, code)], tmpdir(), process.env, 8000, 10_000)));
    expect([clean.timedOut, clean.code]).toEqual([false, 0]);
    expect([failing.timedOut, failing.code]).toEqual([false, 3]);
  }, 40_000);

  // A plain exit ends the call when its pipes close, not when the grace runs out (one without the 'close' handler added
  // the grace to every call).
  it('a plain exit returns when its pipes close, not after the grace', async () => {
    const t0 = Date.now();
    const r = await spawnBounded(process.execPath, ['-e', "process.stdout.write('ENVELOPE')"], tmpdir(), process.env, 20_000, 10_000);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('ENVELOPE');
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.cutShort).toBeUndefined();
  }, 30_000);

  // grok's own descendants — in its process group — are taken down with it when the grace ends (one that skipped the
  // kill left them running). Linux: a zombie waiting for a reaper that may never come counts as gone.
  const helper = (stdio: 'inherit' | 'ignore') => "const { spawn } = require('node:child_process');"
    + ` const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 9000)'], { stdio: '${stdio}' });`
    + " process.stdout.write('GC:' + c.pid + ';', () => process.exit(0));";
  const alive = (pid: number) => {
    try { process.kill(pid, 0); } catch { return false; }
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      return stat.charAt(stat.lastIndexOf(')') + 2) !== 'Z';
    } catch { return false; }
  };
  it.skipIf(process.platform !== 'linux')('grok\'s descendants holding the pipes are killed when the grace ends', async () => {
    const r = await spawnBounded(process.execPath, ['-e', helper('inherit')], tmpdir(), process.env, 6000, 300);
    const pid = Number(/GC:(\d+);/.exec(r.stdout)?.[1]);
    expect(pid).toBeGreaterThan(0);
    try {
      let gone = !alive(pid);
      for (let i = 0; i < 50 && !gone; i++) { await new Promise((res) => setTimeout(res, 20)); gone = !alive(pid); }
      expect(gone).toBe(true);
    } finally {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  }, 20_000);
  // …and only those: an ordinary exit whose pipes close leaves grok's other descendants alone, past the grace too (round
  // 20: versions that killed the group at the exit, or left the grace timer running after the close, passed every test).
  it.skipIf(process.platform !== 'linux')('an ordinary exit leaves grok\'s other descendants alone', async () => {
    const r = await spawnBounded(process.execPath, ['-e', helper('ignore')], tmpdir(), process.env, 6000, 300);
    const pid = Number(/GC:(\d+);/.exec(r.stdout)?.[1]);
    expect(pid).toBeGreaterThan(0);
    try {
      await new Promise((res) => setTimeout(res, 1000));
      expect(alive(pid)).toBe(true);
    } finally {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  }, 20_000);

  it('the cap still ends a run that does not exit', async () => {
    const t0 = Date.now();
    const r = await spawnBounded(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], tmpdir(), process.env, 300, 300);
    expect(r.timedOut).toBe(true);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  // A46's second line of defence: the schema refuses such a value, and the timer clamps it anyway.
  it('a timeout beyond what a timer can hold is not turned into ~1 ms', async () => {
    const r = await spawnBounded(process.execPath, ['-e', 'setTimeout(() => {}, 400)'], tmpdir(), process.env, 3e9, 300);
    expect(r.timedOut).toBe(false);
    expect(r.code).toBe(0);
  });
});

// A42 (docs/10, 2026-09-25 — found by two reviewers independently, confirmed against the source):
// three gaps in what a PLAN run reports. (1) Both plan returns used withSession, not finish, so the
// run's tokens/turns/model (B3) and the id it was started under (B1) never reached a plan result or its
// history row. (2) `committed` (A32) was stated on non-plan runs only — a plan that edited clean files
// and COMMITTED them left the porcelain and `git diff HEAD` unchanged and reported planWroteFiles:false.
// (3) The fingerprint hashed paths plus `git diff HEAD`, which never shows an untracked file, so a plan
// that rewrote a file that was ALREADY untracked produced the same fingerprint — "verified unchanged".
describe('A42 — a plan run reports what it spent and what it did', () => {
  const PLAN = (over: Record<string, unknown> = {}) => JSON.stringify({
    text: 'the plan', stopReason: 'end_turn',
    usage: { input_tokens: 25641, cache_read_input_tokens: 27648, cache_creation_input_tokens: 0, output_tokens: 270, reasoning_tokens: 158, total_tokens: 53559 },
    num_turns: 2,
    modelUsage: { 'grok-4.7-build': { inputTokens: 25641, outputTokens: 270 } },
    ...over,
  });
  const planDeps = (stdout: string, over: Partial<DelegateDeps> = {}): DelegateDeps => ({
    ...deps({ stdout }),
    gitDirtyFingerprint: async () => 'same',
    gitHead: async () => 'head-1',
    ...over,
  });

  it('carries tokens, turns and model like any other run', async () => {
    const r = await runDelegate('subscription', { ...input, plan: true }, planDeps(PLAN({ sessionId: 's-1' })));
    expect(r.status).toBe('completed');
    expect(r.tokens?.total).toBe(53559);
    expect(r.turns).toBe(2);
    expect(r.model).toBe('grok-4.7-build');
    expect(r.sessionId).toBe('s-1');
  });

  it('returns the id it was started under when the envelope names none', async () => {
    let minted = '';
    const r = await runDelegate('subscription', { ...input, plan: true }, planDeps(PLAN(), {
      spawn: async (args) => {
        minted = args[args.indexOf('--session-id') + 1];
        return { code: 0, stdout: PLAN(), stderr: '', timedOut: false };
      },
    }));
    expect(minted).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.sessionId).toBe(minted);
  });

  it('a plan that committed says so and is not reported clean', async () => {
    let head = 0;
    const r = await runDelegate('subscription', { ...input, plan: true }, planDeps(PLAN(), {
      gitHead: async () => (head++ === 0 ? 'head-1' : 'head-2'),
    }));
    expect(r.committed).toBe(true);
    expect(r.planWroteFiles).toBe(true);
    // v0.2.37 pre-merge review: the notice names the folder and the commit HEAD moved from — `git show HEAD` with no
    // folder, run in the user's project, showed and undid THEIR commit for a worktree or relocated run.
    expect(r.message).toContain(`git -C ${shellDir(input.cwd)} log --stat head-1..HEAD`);
    expect(r.message).toContain(`git -C ${shellDir(input.cwd)} reset --soft head-1`);
  });

  it('a plan that left HEAD and the tree alone is still verified clean', async () => {
    const r = await runDelegate('subscription', { ...input, plan: true }, planDeps(PLAN()));
    expect(r.committed).toBe(false);
    expect(r.planWroteFiles).toBe(false);
    expect(r.message).toBeUndefined();
  });

  // The other plan return: an envelope with no plan text is an error, and it spent tokens all the same.
  it('an empty plan is an error that still reports what it spent and the id it ran under', async () => {
    let minted = '';
    const r = await runDelegate('subscription', { ...input, plan: true }, planDeps(PLAN({ text: '' }), {
      spawn: async (args) => {
        minted = args[args.indexOf('--session-id') + 1];
        return { code: 0, stdout: PLAN({ text: '' }), stderr: '', timedOut: false };
      },
    }));
    expect(r.status).toBe('grok_error');
    expect(r.tokens?.total).toBe(53559);
    expect(r.turns).toBe(2);
    expect(r.sessionId).toBe(minted);
  });

  // Real git, several times: a long cap for a starved runner (v0.2.36 pre-merge review, round 20 — 5 s ran out once in
  // 17 runs at 0.1 CPU with grok-cli.test.ts alongside).
  it('real git: rewriting an already-untracked file changes the fingerprint, from a subfolder too', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'grok-fp-'));
    try {
      execFileSync('git', ['init', '-q', repo]);
      execFileSync('git', ['-C', repo, '-c', 'user.email=a@b', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
      mkdirSync(join(repo, 'sub'));
      writeFileSync(join(repo, 'notes.txt'), 'one');
      const fromRoot = await defaultGitDirtyFingerprint(repo);
      const fromSub = await defaultGitDirtyFingerprint(join(repo, 'sub'));
      writeFileSync(join(repo, 'notes.txt'), 'two');
      expect(await defaultGitDirtyFingerprint(repo)).not.toBe(fromRoot);
      expect(await defaultGitDirtyFingerprint(join(repo, 'sub'))).not.toBe(fromSub);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 30_000);

  // The pre-merge review: every untracked file was stat'ed and read, one at a time — 20,000 of them (an
  // unignored node_modules) took 7.2–8.4 s per fingerprint, twice per plan run, outside timeout_ms. The
  // first cap then read NOTHING past the first files, and in exactly that layout every source file sorts
  // after node_modules/ — a plan that edited an untracked src/feature.ts reported planWroteFiles:false
  // (re-review). Every file is now stat'ed (size and mtime); only the first files' contents are read.
  it('real git: past the content cap a rewrite is still seen, through size and mtime', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'grok-fp-cap-'));
    try {
      execFileSync('git', ['init', '-q', repo]);
      execFileSync('git', ['-C', repo, '-c', 'user.email=a@b', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
      for (const f of ['a.txt', 'b.txt', 'c.txt']) writeFileSync(join(repo, f), 'one');
      const later = new Date(Date.now() + 60_000);
      let before = await defaultGitDirtyFingerprint(repo, 2);
      writeFileSync(join(repo, 'c.txt'), 'two');
      utimesSync(join(repo, 'c.txt'), later, later);
      expect(await defaultGitDirtyFingerprint(repo, 2), 'c.txt is past the cap: its mtime moved').not.toBe(before);
      before = await defaultGitDirtyFingerprint(repo, 2);
      writeFileSync(join(repo, 'c.txt'), 'twenty bytes of text');
      expect(await defaultGitDirtyFingerprint(repo, 2), 'past the cap: its size moved').not.toBe(before);
      // Inside the cap the content counts: a same-size rewrite with the mtime put back is still seen. A
      // whole-second mtime, because restoring from a Date drops the sub-millisecond part NTFS keeps — the
      // first version of this test then passed on the mtime, not the content.
      const fixed = new Date('2020-01-01T00:00:00Z');
      const a = join(repo, 'a.txt');
      utimesSync(a, fixed, fixed);
      before = await defaultGitDirtyFingerprint(repo, 2);
      writeFileSync(a, 'two');
      utimesSync(a, fixed, fixed);
      expect(await defaultGitDirtyFingerprint(repo, 2), 'content, inside the cap').not.toBe(before);
      // The residual, past the cap: same size and the mtime put back — nothing left to see.
      const c = join(repo, 'c.txt');
      utimesSync(c, fixed, fixed);
      before = await defaultGitDirtyFingerprint(repo, 2);
      writeFileSync(c, 'TWENTY BYTES OF TEXT');
      utimesSync(c, fixed, fixed);
      expect(await defaultGitDirtyFingerprint(repo, 2), 'the documented residual').toBe(before);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  // A symlink is hashed by what it points at, not by reading through it (git keeps a link as its target
  // text too). Reading through it followed `/proc/self/pagemap` on Linux — stat says a regular file of
  // size 0, and the read never ended: 10 GiB in 30 s (re-review).
  it('real git: an untracked symlink counts by its target, and is not read through', async (ctx) => {
    const repo = mkdtempSync(join(tmpdir(), 'grok-fp-link-'));
    try {
      execFileSync('git', ['init', '-q', repo]);
      execFileSync('git', ['-C', repo, '-c', 'user.email=a@b', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
      writeFileSync(join(repo, 'a.txt'), 'one');
      writeFileSync(join(repo, 'b.txt'), 'two');
      try { symlinkSync('a.txt', join(repo, 'link')); } catch { ctx.skip(); } // win32 without the privilege
      const before = await defaultGitDirtyFingerprint(repo);
      rmSync(join(repo, 'link'));
      symlinkSync('b.txt', join(repo, 'link'));
      expect(await defaultGitDirtyFingerprint(repo)).not.toBe(before);
      if (process.platform === 'linux') {
        symlinkSync('/proc/self/pagemap', join(repo, 'pagemap'));
        const t0 = Date.now();
        expect(await defaultGitDirtyFingerprint(repo)).not.toBeNull();
        expect(Date.now() - t0).toBeLessThan(5_000);
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 30_000);

  // Round 3, on Linux: a file lstat'ed as regular and then swapped for a FIFO blocked the open until a
  // writer came — 28 s and counting, outside timeout_ms, and the process then ignored process.exit. The
  // read now opens without blocking and without following a link, and reads only what is still a file.
  it.skipIf(process.platform === 'win32')('the bounded read neither blocks on a FIFO nor follows a link', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grok-fp-fifo-'));
    try {
      const fifo = join(dir, 'pipe');
      execFileSync('mkfifo', [fifo]);
      const t0 = Date.now();
      expect(await readExactly(fifo, 16)).toBeNull();
      expect(Date.now() - t0).toBeLessThan(2_000);
      writeFileSync(join(dir, 'target'), 'secret');
      symlinkSync(join(dir, 'target'), join(dir, 'link'));
      expect(await readExactly(join(dir, 'link'), 6)).toBeNull();
      expect(String(await readExactly(join(dir, 'target'), 6))).toBe('secret');
      // Only a regular file is read. A FIFO fails its positional read anyway, so without this a version
      // that dropped the check passed (round 4) — a device does not fail: /dev/zero gave 8 bytes.
      expect(await readExactly('/dev/zero', 8)).toBeNull();
    } finally {
      // A blocked open would still hold the FIFO; a writer releases it so the worker can exit.
      try { execFileSync('sh', ['-c', `exec 3<>'${join(dir, 'pipe')}'`], { timeout: 2_000 }); } catch { /* not blocked */ }
      rmSync(dir, { recursive: true, force: true });
    }
  }, 10_000);

  // The pre-merge review, on Linux: `--show-toplevel` of a repo whose folder name ends in a space was
  // trimmed, every stat failed, and both fingerprints hashed the same `(unreadable)` — 3 of 3 rewrites
  // missed. Windows does not allow such a name.
  it.skipIf(process.platform === 'win32')('real git: a repo folder whose name ends in a space', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'grok-fp-space-'));
    const repo = join(parent, 'repo ');
    try {
      mkdirSync(repo);
      execFileSync('git', ['init', '-q', repo]);
      execFileSync('git', ['-C', repo, '-c', 'user.email=a@b', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
      writeFileSync(join(repo, 'notes.txt'), 'one');
      const before = await defaultGitDirtyFingerprint(repo);
      writeFileSync(join(repo, 'notes.txt'), 'two');
      expect(await defaultGitDirtyFingerprint(repo)).not.toBe(before);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe('appendBounded (subprocess output caps)', () => {
  it('keeps the head of stdout so a small valid JSON is never truncated', () => {
    expect(appendBounded('', 'abc', 10, 'head')).toBe('abc');
    expect(appendBounded('abc', 'defgh', 10, 'head')).toBe('abcdefgh');
  });
  it('stops growing stdout past the limit instead of accumulating forever', () => {
    const out = appendBounded('0123456789', 'XXXXX', 10, 'head');
    expect(out).toBe('0123456789');
    expect(out.length).toBe(10);
  });
  it('truncates a straddling chunk exactly at the limit', () => {
    expect(appendBounded('01234', 'ABCDEFG', 8, 'head')).toBe('01234ABC');
  });
  it('keeps the tail of stderr because only the last bytes are ever read', () => {
    expect(appendBounded('0123456789', 'ABCDE', 10, 'tail')).toBe('56789ABCDE');
  });
  it('is a no-op for an empty chunk', () => {
    expect(appendBounded('abc', '', 10, 'head')).toBe('abc');
    expect(appendBounded('abc', '', 10, 'tail')).toBe('abc');
  });
  it('caps are large enough not to disturb ordinary runs', () => {
    expect(STDOUT_CAP_BYTES).toBeGreaterThanOrEqual(8 * 1024 * 1024);
    expect(STDERR_CAP_BYTES).toBeGreaterThanOrEqual(256 * 1024);
    expect(Number.isFinite(STDOUT_CAP_BYTES)).toBe(true);
    expect(Number.isFinite(STDERR_CAP_BYTES)).toBe(true);
  });
});

describe('worktree creation failure reporting', () => {
  it('includes the underlying cause instead of only guessing at the repo state', async () => {
    const r = await runDelegate('subscription', { prompt: 'x', cwd: '/tmp/proj', worktree: true }, {
      spawn: async () => ({ code: 0, stdout: '{}', stderr: '', timedOut: false }),
      gitChangedFiles: async () => [],
      dirExists: () => true,
      createWorktree: async () => { throw new Error('Command failed: git worktree add — killed: SIGTERM'); },
      env: {},
    });
    expect(r.status).toBe('grok_error');
    // A 30s SIGTERM on a large checkout is not "cwd is not a git repo"; the message must not
    // send the user chasing the wrong thing.
    expect(r.message).toMatch(/SIGTERM/);
  });
});

// ── Audit findings, 2026-09-02. ────────────────────────────────────────────────────────

describe('runDelegate prompt argv (audit: a leading dash never reached the model)', () => {
  // `-p <prompt>` passes the prompt as a bare option value, and clap refuses any value that
  // starts with `-`: exit 2, empty stdout, no model call. runDelegate then landed on the
  // parse-failure branch and blamed grok's output for output grok never produced.
  // Measured on 1.0.13: `-p "- Refactor"` exits 2; `"--single=- Refactor"` exits 0.
  const capture = async (prompt: string) => {
    let args: string[] = [];
    await runDelegate('subscription', { prompt, cwd: '/abs/repo' }, {
      spawn: async (a) => {
        args = a;
        return { code: 0, stdout: '{"text":"ok","stopReason":"end_turn"}', stderr: '', timedOut: false };
      },
      gitChangedFiles: async () => [],
      dirExists: () => true,
      env: {},
    });
    return args;
  };

  it('passes the prompt in the equals form, so clap cannot mistake it for a flag', async () => {
    const args = await capture('- Refactor the module');
    // A32: prefix, not whole token — the suffix follows the prompt. What matters here is that
    // the leading `-` sits INSIDE an `--single=` token and never becomes a bare option value.
    expect(args.some((a) => a.startsWith('--single=- Refactor the module'))).toBe(true);
    expect(args).not.toContain('-p');
  });

  it('uses the same shape for an ordinary prompt', async () => {
    const args = await capture('Refactor the module');
    expect(args.some((a) => a.startsWith('--single=Refactor the module'))).toBe(true);
  });

  it('keeps multi-line prompts intact', async () => {
    const args = await capture('Do this:\n- one\n- two');
    expect(args.some((a) => a.startsWith('--single=Do this:\n- one\n- two'))).toBe(true);
  });
});

describe('defaultGitChangedFiles untracked directories (audit: files were invisible)', () => {
  // Without -uall, git collapses an untracked directory to a single `?? dir/` entry, so files
  // created inside one never appear — and once the directory is in the before-snapshot too,
  // before and after are byte-identical and the diff reports nothing changed at all. The
  // plugin never commits, so such a directory stays untracked for every follow-up delegation.
  it('lists each file inside an untracked directory, not the directory alone', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'grok-uall-'));
    const git = (args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' });
    git(['init', '-q', '.']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'test']);
    git(['commit', '-q', '--allow-empty', '-m', 'base']);
    mkdirSync(join(repo, 'newdir'));
    writeFileSync(join(repo, 'newdir', 'a.txt'), 'a\n');
    writeFileSync(join(repo, 'newdir', 'b.txt'), 'b\n');

    const files = await defaultGitChangedFiles(repo);

    expect([...files].sort()).toEqual(['newdir/a.txt', 'newdir/b.txt']);
    rmSync(repo, { recursive: true, force: true });
  }, 30_000);
});

// MEASURED 2026-09-05 service audit: a grok CLI 1.0.13 plan run wrote files, and --sandbox
// read-only/strict did not stop it on win32 either; the user's own allow rules approved writes under
// plan on 1.0.41/1.0.44 too (contract §6). Since A50 every plan carries deny rules (PLAN_DENY_ARGS),
// but honouring them is grok's job, so the plugin must still never report a clean tree when a write happened.
describe('plan runs report writes instead of hiding them (audit FAIL 1)', () => {
  const planInput = { prompt: 'plan something', cwd: '/tmp/proj', plan: true };
  const planDeps = (
    files: [string[], string[]],
    prints: [string | null, string | null],
  ): DelegateDeps => {
    let f = 0;
    let p = 0;
    return {
      spawn: fakeSpawn({ stdout: JSON.stringify({ text: 'here is the plan', stopReason: 'end_turn' }) }),
      gitChangedFiles: () => files[f++] ?? files[files.length - 1],
      gitDirtyFingerprint: async () => prints[p++] ?? prints[prints.length - 1],
      dirExists: () => true,
    };
  };

  it('flags a write to a file that was ALREADY dirty', async () => {
    // The set difference over paths is blind here (before === after), which is exactly the
    // plan-before-delegate case on work in progress. The fingerprint is what catches it.
    const r = await runDelegate('subscription', planInput, planDeps([['a.ts'], ['a.ts']], ['h1', 'h2']));
    expect(r.status).toBe('completed');
    expect(r.planWroteFiles).toBe(true);
    expect(r.message).toMatch(/읽기 전용/);
  });

  it('flags a newly created file', async () => {
    const r = await runDelegate('subscription', planInput, planDeps([[], ['new.txt']], ['h1', 'h2']));
    expect(r.planWroteFiles).toBe(true);
    expect(r.filesChanged).toEqual(['new.txt']);
  });

  it('reports false — and stays quiet — when the tree really did not change', async () => {
    const r = await runDelegate('subscription', planInput, planDeps([[], []], ['same', 'same']));
    expect(r.planWroteFiles).toBe(false);
    expect(r.message).toBeUndefined();
    expect(r.summary).toBe('here is the plan');
  });

  it('says "could not check" rather than "clean" outside a git repo', async () => {
    const r = await runDelegate('subscription', planInput, planDeps([[], []], [null, null]));
    expect(r.planWroteFiles).toBeUndefined();
    expect(r.message).toMatch(/확인할 수 없었습니다/);
  });

  it('leaves non-plan delegations untouched', async () => {
    const r = await runDelegate(
      'subscription',
      { prompt: 'do x', cwd: '/tmp/proj' },
      deps({ stdout: okJson() }, ['x.ts']),
    );
    expect(r.planWroteFiles).toBeUndefined();
  });
});

// A32 (MEASURED 2026-09-22 on grok 1.0.30, in a scratch repo, with the wrapper's own argv shape):
//   grok --always-approve --cwd <repo> "--single=Add a line to f.txt, then git add and git commit…"
//   -> HEAD 4f91a63 -> 7b862d3 ("grok did this").  git status --porcelain: f.txt GONE from the list.
// Two separate failures in one: nothing told grok not to commit, and once it had committed the
// edit became INVISIBLE — `filesChanged` is a porcelain set difference, and committing cleans the
// tree, so the wrapper would have reported an empty list for a run that changed a tracked file.
// `자동 커밋은 하지 않는다` is an absolute principle (CLAUDE.md #1) and the diff-review gate the
// whole routing policy rests on assumes it.
//
// The same probe measured the fix. A prompt suffix alone is enough to stop it:
//   same prompt + the suffix -> HEAD unchanged, ` M f.txt` still in porcelain, and grok replied
//   "Committing isn't allowed in this run, so I won't `git add` or `git commit`."
// A suffix is used instead of 1.0.30's `--rules` (which also worked, measured): it costs a few tokens
// and cannot break a version. (`--rules` is in 1.0.13's `--help` too — re-checked 2026-10-04.)
//
// Prevention is persuasion, so it is paired with detection, exactly like planWroteFiles: HEAD is
// read before and after every run and `committed` is the machine signal.
// B1 — MEASURED 2026-09-22 against grok 1.0.30, which is what makes this safe to do:
//   a caller-minted v4 UUID is accepted by `--session-id` and echoed back unchanged
//     (requested 630f2095-3470-4719-8f40-4cb131791f89, envelope sessionId identical)
//   a run SIGKILLed at 25s still left a full session under that id:
//     ~/.grok/sessions/<enc-cwd>/6959da13-…/chat_history.jsonl, 54,783 bytes, and
//     `grok sessions list` shows it with a real summary
// grok's own ids are UUIDv7-shaped and `randomUUID()` mints v4; the help says only "valid UUID",
// and the measurement above is what settles it.
//
// Why it matters: the session id only ever existed AFTER a successful parse, so the runs that
// most need a handle — the long ones Grok 4.7 is built for, killed at the timeout with partial
// edits on disk — were the only ones that had none. Re-derived from the owner's real history
// (845 rows): 82 timeout rows, 82 of them with no sessionId.
describe('B1 — a delegation keeps its session handle even when it never returns one', () => {
  const cap = () => {
    let args: string[] = [];
    return {
      args: () => args,
      deps: {
        spawn: async (a: string[]) => {
          args = a;
          return { code: 0, stdout: okJson(), stderr: '', timedOut: false };
        },
        gitChangedFiles: async () => [],
        dirExists: () => true,
      } as unknown as DelegateDeps,
    };
  };

  it('mints a session id up front and passes it to grok', async () => {
    const c = cap();
    const r = await runDelegate('subscription', input, c.deps);
    const i = c.args().indexOf('--session-id');
    expect(i).toBeGreaterThan(-1);
    const sent = c.args()[i + 1];
    expect(sent).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // grok echoed no id in this envelope, so the minted one is what the caller gets back.
    expect(r.sessionId).toBe(sent);
  });

  it('a timed-out run still reports the handle — the whole point', async () => {
    const r = await runDelegate('subscription', input, {
      spawn: fakeSpawn({ timedOut: true, code: null }),
      gitChangedFiles: async () => [],
      dirExists: () => true,
    } as unknown as DelegateDeps);
    expect(r.status).toBe('timeout');
    expect(r.sessionId).toMatch(/^[0-9a-f]{8}-/);
  });

  it('prefers the id grok reported over the minted one', async () => {
    const r = await runDelegate('subscription', input, {
      spawn: fakeSpawn({ stdout: okJson({ sessionId: 'grok-owns-this' }) }),
      gitChangedFiles: async () => [],
      dirExists: () => true,
    } as unknown as DelegateDeps);
    expect(r.sessionId).toBe('grok-owns-this');
  });

  // help.txt: `-s` with --resume/--continue is only legal alongside --fork-session, which this
  // wrapper does not pass. Minting one there would make every resume exit 2.
  it('does not mint one when resuming or continuing', async () => {
    for (const extra of [{ resumeSessionId: 'sess-1' }, { continueSession: true }]) {
      const c = cap();
      await runDelegate('subscription', { ...input, ...extra }, c.deps);
      expect(c.args(), JSON.stringify(extra)).not.toContain('--session-id');
    }
  });

  // A spawn that never started has no session to name. Claiming one would be a fiction.
  it('claims nothing when the process could not start', async () => {
    const r = await runDelegate('subscription', input, {
      spawn: fakeSpawn({ spawnError: true, code: null, stderr: 'ENOENT' }),
      gitChangedFiles: async () => [],
      dirExists: () => true,
    } as unknown as DelegateDeps);
    expect(r.sessionId).toBeUndefined();
  });
});

// B2 — MEASURED 2026-09-22 on grok 1.0.30: `--max-turns 1` on a three-file task stopped after the
// first file, exit 1, stopReason `cancelled`, stderr "Error: max turns reached". A work-based
// bound, where the wrapper previously had only a 180s wall clock enforced by SIGKILL — against a
// model xAI sells on multi-hour runs.
describe('B2 — maxTurns is a work budget, validated before the spawn', () => {
  const capArgs = async (over: Record<string, unknown>) => {
    let args: string[] = [];
    const r = await runDelegate('subscription', { ...input, ...over }, {
      spawn: async (a: string[]) => {
        args = a;
        return { code: 0, stdout: okJson(), stderr: '', timedOut: false };
      },
      gitChangedFiles: async () => [],
      dirExists: () => true,
    } as unknown as DelegateDeps);
    return { args, r };
  };

  it('passes a valid budget through', async () => {
    const { args } = await capArgs({ maxTurns: 12 });
    expect(args[args.indexOf('--max-turns') + 1]).toBe('12');
  });

  it('omits the flag entirely when not asked for', async () => {
    const { args } = await capArgs({});
    expect(args).not.toContain('--max-turns');
  });

  it('refuses a nonsense budget without spawning, like the other opt-in flags', async () => {
    for (const bad of [0, -1, 1.5, Number.NaN, '3' as unknown as number]) {
      let spawned = false;
      const r = await runDelegate('subscription', { ...input, maxTurns: bad as number }, {
        spawn: async () => { spawned = true; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; },
        gitChangedFiles: async () => [],
        dirExists: () => true,
      } as unknown as DelegateDeps);
      expect(r.status, String(bad)).toBe('grok_error');
      expect(spawned, String(bad)).toBe(false);
    }
  });
});

describe('A32 — the no-auto-commit invariant is instructed AND verified', () => {
  const headDeps = (heads: (string | null)[], files: string[] = []) => {
    let g = 0, h = 0;
    return {
      spawn: fakeSpawn({ stdout: okJson() }),
      gitChangedFiles: () => (g += 1, g === 1 ? [] : files),
      gitHead: async () => heads[h++] ?? heads[heads.length - 1],
      dirExists: () => true,
    } as unknown as DelegateDeps;
  };

  it('flags a delegation that moved HEAD, and says the diff gate was bypassed', async () => {
    const r = await runDelegate('subscription', input, headDeps(['aaa', 'bbb']));
    expect(r.status).toBe('completed');
    expect(r.committed).toBe(true);
    expect(r.message).toMatch(/커밋/);
  });

  it('reports false and stays quiet when HEAD did not move', async () => {
    const r = await runDelegate('subscription', input, headDeps(['aaa', 'aaa'], ['x.ts']));
    expect(r.committed).toBe(false);
    expect(r.message).toBeUndefined();
    expect(r.filesChanged).toEqual(['x.ts']);
  });

  it('says "could not check" rather than "clean" outside a git repo', async () => {
    const r = await runDelegate('subscription', input, headDeps([null, null]));
    expect(r.committed).toBeUndefined();
    expect(r.message).toBeUndefined();
  });

  // A49 (docs/10, MEASURED 2026-09-28 through the v0.2.36 bundle with a stand-in grok that committed and then ended):
  // `committed` was stated on completed runs only. After exit 1 the result was `grok_error` with no `committed` and a
  // message that never mentioned the commit; after the cap, `timeout` the same; the history row recorded neither. Every
  // shipped prompt stops on a non-completed status and shows only the message, so a commit — which bypasses the diff
  // gate — went unreported exactly when the run also failed. The endings below are the ones sent to the bundle.
  it.each([
    ['exit 1 after committing', { code: 1, stdout: '', stderr: 'boom' }, 'grok_error'],
    ['past the cap after committing', { code: null, stdout: '', stderr: '', timedOut: true }, 'timeout'],
    ['an error stopReason after committing', { code: 0, stdout: okJson({ stopReason: 'Error', text: 'failed' }) }, 'grok_error'],
  ] as const)('a run that ended badly still says grok committed: %s', async (_label, ending, status) => {
    let h = 0;
    const heads = ['aaa', 'bbb'];
    const r = await runDelegate('subscription', input, {
      spawn: fakeSpawn(ending),
      gitChangedFiles: async () => [],
      gitHead: async () => heads[h++] ?? 'bbb',
      dirExists: () => true,
    } as unknown as DelegateDeps);
    expect([r.status, r.committed]).toEqual([status, true]);
    // The failure's own message stays first; the commit is named after it, with the folder and how to inspect and undo
    // it from the commit HEAD moved from (once — round 1's reviewer checked it is not doubled).
    expect(r.message).toMatch(/커밋/);
    expect(r.message!.split(`git -C ${shellDir(input.cwd)} reset --soft aaa`).length - 1).toBe(1);
    expect(r.message!.indexOf('커밋')).toBeGreaterThan(0);
    // …and a run that ended badly WITHOUT moving HEAD says so too — "could be read", as on a completed run.
    let g = 0;
    const same = await runDelegate('subscription', input, {
      spawn: fakeSpawn(ending),
      gitChangedFiles: async () => [],
      gitHead: async () => (g++, 'aaa'),
      dirExists: () => true,
    } as unknown as DelegateDeps);
    expect([same.status, same.committed]).toEqual([status, false]);
    expect(same.message ?? '').not.toMatch(/커밋/);
  });

  it('sends the no-commit constraint on a plain delegate, not only on verify', async () => {
    let sent = '';
    await runDelegate('subscription', input, {
      spawn: async (args: string[]) => {
        sent = args.find((a) => a.startsWith('--single=')) ?? '';
        return { code: 0, stdout: okJson(), stderr: '', timedOut: false };
      },
      gitChangedFiles: async () => [],
      dirExists: () => true,
    } as unknown as DelegateDeps);
    expect(sent).toMatch(/do x/);
    expect(sent).toMatch(/commit/i);
  });
});

// A3 (docs/10, MEASURED 2026-09-05 against the shipped 0.2.19 bundle):
//   delegate {prompt:"Create a.txt …", cwd:<dirA>, resume:"01a071e1-…"}   // session was born in dirB
//   -> status completed, filesChanged: [], and a.txt written into dirB.
// The caller asked for dirA, grok wrote dirB, and NOTHING in the response said so — not the
// status, not filesChanged, not the history row (which recorded cwd as dirA). grok's --resume
// overrides --cwd, and the wrapper had no way to notice.
//
// grok stores a session under <grokHome>/sessions/<url-encoded cwd>/<sessionId>, so the owning
// directory is recoverable after the fact. The probe is best-effort by construction: it reads a
// layout this repo does not own, so failing to find the session must produce NO claim at all
// rather than a wrong one.
describe('A3 — resume must not silently relocate the work', () => {
  const SID = '01a071e1-09d3-7b12-9904-6c1883b841b6';
  // Absolute on BOTH platforms: 'C:/x' is not absolute on POSIX, which failed runDelegate's
  // cwd guard on Linux CI. The slash-vs-backslash spelling that A3 is really about is exercised
  // by the pure sameDirectory test below, which does not go through that guard.
  // v0.2.37 round 3: on win32 a drive-less `/tmp/…` is named in the commit notice with the drive it resolves on
  // (shellDir), so the folders the notice tests name carry a drive there — the notice then quotes them as written.
  const onDrive = (p: string) => (process.platform === 'win32' ? `C:${p}` : p);
  const dirA = onDrive('/tmp/a3dirA');
  const dirB = onDrive('/tmp/a3dirB');
  const wtDir = onDrive('/tmp/a3wt');

  const sessionsIndex = (owner: string) => ({
    listSessionDirs: () => [encodeURIComponent(owner)],
    sessionDirHasId: (encoded: string, id: string) => encoded === encodeURIComponent(owner) && id === SID,
  });

  it('finds the directory a session actually belongs to', () => {
    expect(resolveSessionCwd(SID, sessionsIndex(dirB))).toBe(dirB);
  });

  it('says nothing when the session cannot be located — no claim beats a wrong one', () => {
    expect(resolveSessionCwd(SID, { listSessionDirs: () => [], sessionDirHasId: () => false })).toBeUndefined();
    expect(resolveSessionCwd(undefined, sessionsIndex(dirB))).toBeUndefined();
  });

  // A69 (contract §12): once the url-encoded cwd tops 255 bytes grok names the session dir
  // `<slug>-<16hex>` and stores the real cwd in `<dir>/.cwd`. decodeURIComponent leaves the slug-hash
  // unchanged (it is not a path), and v0.2.45 reported that slug as the cwd — falsely saying grok
  // worked there. The decode is not absolute, so resolveSessionCwd reads `.cwd` instead.
  const slug = 'aaaa-4d506a2863e2f73d';
  const slugIndex = (readLongNameCwd: (dir: string) => string | undefined) => ({
    listSessionDirs: () => [slug],
    sessionDirHasId: (dir: string, id: string) => dir === slug && id === SID,
    readLongNameCwd,
  });

  it('A69: a slug-hash session dir resolves through .cwd — the real cwd, never the slug', () => {
    expect(resolveSessionCwd(SID, slugIndex((dir) => (dir === slug ? dirB : undefined)))).toBe(dirB);
  });

  it('A69: a slug-hash dir with no readable absolute .cwd makes no claim — never the slug', () => {
    expect(resolveSessionCwd(SID, slugIndex(() => undefined))).toBeUndefined();
    // an index that cannot read .cwd at all (an older or again-changed layout) also stays silent
    expect(resolveSessionCwd(SID, { listSessionDirs: () => [slug], sessionDirHasId: () => true }))
      .toBeUndefined();
  });

  it('A69: defaultSessionsIndex.readLongNameCwd reads an absolute .cwd, rejecting the rest', () => {
    const root = mkdtempSync(join(tmpdir(), 'a69-cwd-'));
    try {
      mkdirSync(join(root, 'sessions', slug), { recursive: true });
      writeFileSync(join(root, 'sessions', slug, '.cwd'), dirB + '\r\n'); // a trailing newline is dropped
      mkdirSync(join(root, 'sessions', 'rel'), { recursive: true });
      writeFileSync(join(root, 'sessions', 'rel', '.cwd'), 'not/absolute'); // not absolute -> no claim
      const idx = defaultSessionsIndex({ GROK_HOME: root });
      expect(idx.readLongNameCwd!(slug)).toBe(dirB);
      expect(idx.readLongNameCwd!('rel')).toBeUndefined();
      expect(idx.readLongNameCwd!('no-such-dir')).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('treats a path as the same directory however it was spelled', () => {
    // The request goes out with forward slashes; grok stores backslashes. Same directory.
    expect(sameDirectory('C:/tmp/a3dirB', 'C:\\tmp\\a3dirB')).toBe(true);
    expect(sameDirectory('C:/tmp/a3dirB/', 'C:\\tmp\\a3dirB')).toBe(true);
    expect(sameDirectory('C:/tmp/a3dirA', 'C:\\tmp\\a3dirB')).toBe(false);
  });

  // A49, second half (found reading the A49 fix — Grok's classification flagged this path, from facts that omitted how
  // it appends): HEAD was read in the REQUESTED folder only. A resume that grok ran in the session's own folder and
  // committed there left the requested HEAD where it was, and the result said `committed: false` — "verified: no
  // commit" — about a folder grok never worked in.
  const headsBy = (moves: Record<string, [string, string]>) => {
    const seen: Record<string, number> = {};
    return async (cwd: string) => {
      const key = Object.keys(moves).find((d) => sameDirectory(d, cwd));
      if (!key) return 'still';
      seen[key] = (seen[key] ?? 0) + 1;
      return seen[key] === 1 ? moves[key][0] : moves[key][1];
    };
  };
  it.each([
    ['completed', { code: 0, stdout: JSON.stringify({ text: 'done', stopReason: 'end_turn', sessionId: SID }) }, 'completed'],
    ['exit 1', { code: 1, stdout: '', stderr: 'boom' }, 'grok_error'],
  ] as const)('a resume that committed in the session\'s own folder says so (%s)', async (_label, ending, status) => {
    const run = (moves: Record<string, [string, string]>) => runDelegate('subscription', { prompt: 'p', cwd: dirA, resumeSessionId: SID }, {
      spawn: async () => ({ stderr: '', timedOut: false, ...ending }),
      dirExists: () => true,
      gitChangedFiles: async () => [],
      gitHead: headsBy(moves),
      sessionsIndex: sessionsIndex(dirB),
      env: {},
    } as never);
    const moved = await run({ [dirA]: ['a1', 'a1'], [dirB]: ['b1', 'b2'] });
    expect([moved.status, moved.resumedCwd, moved.committed]).toEqual([status, dirB, true]);
    // The notice names the session's folder — the one whose HEAD moved — never the requested one.
    expect(moved.message).toContain(`git -C '${dirB}' reset --soft b1`);
    expect(moved.message).not.toContain(`git -C '${dirA}'`);
    expect(moved.message).toMatch(/resume/i);
    const still = await run({ [dirA]: ['a1', 'a1'], [dirB]: ['b1', 'b1'] });
    expect([still.status, still.committed]).toEqual([status, false]);
  });

  // The plan fingerprint follows the same folders: a resumed plan that rewrote an already-dirty file in the session's
  // folder (no new path, so filesChanged cannot show it — A42) is a write; a continued one is not verified.
  it('a resumed plan that rewrote a dirty file in the session\'s folder is not reported clean', async () => {
    const printsBy = (moves: Record<string, [string, string]>) => {
      const seen: Record<string, number> = {};
      return async (cwd: string) => {
        const key = Object.keys(moves).find((d) => sameDirectory(d, cwd));
        if (!key) return 'still';
        seen[key] = (seen[key] ?? 0) + 1;
        return seen[key] === 1 ? moves[key][0] : moves[key][1];
      };
    };
    const run = (moves: Record<string, [string, string]>, how: Record<string, unknown>) => runDelegate('subscription',
      { prompt: 'p', cwd: dirA, plan: true, ...how }, {
        spawn: async () => ({ code: 0, stdout: JSON.stringify({ text: 'the plan', stopReason: 'end_turn', sessionId: SID }), stderr: '', timedOut: false }),
        dirExists: () => true,
        gitChangedFiles: async () => [],
        gitHead: async () => 'h',
        gitDirtyFingerprint: printsBy(moves),
        sessionsIndex: sessionsIndex(dirB),
        env: {},
      } as never);
    const wrote = await run({ [dirA]: ['a', 'a'], [dirB]: ['b1', 'b2'] }, { resumeSessionId: SID });
    expect([wrote.resumedCwd, wrote.planWroteFiles]).toEqual([dirB, true]);
    const clean = await run({ [dirA]: ['a', 'a'], [dirB]: ['b1', 'b1'] }, { resumeSessionId: SID });
    expect([clean.resumedCwd, clean.planWroteFiles]).toEqual([dirB, false]);
    const continued = await run({ [dirA]: ['a', 'a'] }, { continueSession: true });
    expect([continued.resumedCwd, continued.planWroteFiles, continued.committed]).toEqual([dirB, undefined, undefined]);
  });

  // v0.2.37 pre-merge review, round 1. The first A49 fix demoted `false` only for a continue that resolved ELSEWHERE; a
  // continue that ended with no envelope (no session id to resolve) and a resume whose session was not in the index
  // kept `false` from the requested folder — measured on the bundle with a commit in the continued folder. And the
  // notice named no folder: for a worktree or relocated run, `git reset --soft HEAD~1` typed in the project undoes the
  // user's own commit. The probes K1-K19 are the review's, kept as it wrote them (adapted to the new notice).
  const run2 = (input: Record<string, unknown>, ending: object, heads: Record<string, [string | null, string | null]>,
    extra: Record<string, unknown> = {}) => runDelegate('subscription', { prompt: 'p', cwd: dirA, ...input } as never, {
    spawn: async () => ({ code: 0, stdout: '', stderr: '', timedOut: false, ...ending }) as never,
    dirExists: () => true,
    gitChangedFiles: async () => [],
    gitHead: headsBy(heads as Record<string, [string, string]>),
    gitDirtyFingerprint: async () => 'same',
    sessionsIndex: sessionsIndex(dirB),
    env: {},
    ...extra,
  } as never);
  const done = { code: 0, stdout: JSON.stringify({ text: 'done', stopReason: 'end_turn', sessionId: SID }) };
  const exit1 = { code: 1, stdout: '', stderr: 'boom' };
  const timeout = { code: null, stdout: '', timedOut: true };

  it.each([['timed out', timeout], ['exit 1 with no envelope', exit1]] as const)(
    'a continue that ended with no session id does not claim "no commit" (%s)', async (_label, ending) => {
      const r = await run2({ continueSession: true }, ending, { [dirA]: ['a', 'a'] });
      expect(r.committed).toBeUndefined();
      expect(r.message).toMatch(/확인하지 못했습니다/);
      // …and one that did resolve to the requested folder was measured there: its `false` stands.
      const here = await run2({ continueSession: true }, { code: 0, stdout: JSON.stringify({ text: 'done', stopReason: 'end_turn', sessionId: SID }) },
        { [dirA]: ['a', 'a'] }, { sessionsIndex: sessionsIndex(dirA) });
      expect([here.resumedCwd, here.committed]).toEqual([undefined, false]);
    });

  it.each([['completed', done], ['timed out', timeout]] as const)(
    'a resume whose session is not in the index does not claim "no commit" (%s)', async (_label, ending) => {
      const r = await run2({ resumeSessionId: SID }, ending, { [dirA]: ['a', 'a'] },
        { sessionsIndex: { listSessionDirs: () => [], sessionDirHasId: () => false } });
      expect(r.committed).toBeUndefined();
    });

  it('K1: a readable folder that changed beats an unreadable one', async () => {
    const r = await run2({ resumeSessionId: SID }, done, { [dirA]: [null, null], [dirB]: ['b1', 'b2'] });
    expect(r.committed).toBe(true);
    expect(r.message).toContain(`git -C '${dirB}' reset --soft b1`);
  });
  it('K2: the failure message stays first', async () => {
    const r = await run2({}, exit1, { [dirA]: ['a', 'b'] });
    expect(r.message?.startsWith('Grok Build가 결과를 반환하지 않았습니다')).toBe(true);
  });
  it('K3: a completed or plan commit is named once', async () => {
    const r = await run2({}, done, { [dirA]: ['a', 'b'] });
    expect(r.message!.split('reset --soft a').length - 1).toBe(1);
    const p = await run2({ plan: true }, { code: 0, stdout: JSON.stringify({ text: 'the plan', stopReason: 'end_turn', sessionId: SID }) },
      { [dirA]: ['a', 'b'] });
    expect(p.message!.split('reset --soft a').length - 1).toBe(1);
  });
  it('K10: a resume into a folder that cannot be read is not "no commit"', async () => {
    const r = await run2({ resumeSessionId: SID }, done, { [dirA]: ['a', 'a'], [dirB]: [null, null] });
    expect(r.committed).toBeUndefined();
  });
  it('K11: a continue keeps a commit it saw', async () => {
    const r = await run2({ continueSession: true }, done, { [dirA]: ['a', 'b'] });
    expect([r.resumedCwd, r.committed]).toEqual([dirB, true]);
  });
  it('K19: a non-plan run does not fingerprint the tree', async () => {
    let prints = 0;
    await run2({}, done, { [dirA]: ['a', 'a'] }, { gitDirtyFingerprint: async () => { prints++; return 'x'; } });
    expect(prints).toBe(0);
  });

  it('a worktree run that committed names the worktree, and says diff/apply do not carry the commit', async () => {
    const wt = wtDir;
    const r = await run2({ worktree: true }, exit1, { [wt]: ['w1', 'w2'] }, { createWorktree: async () => wt });
    expect([r.status, r.committed, r.worktreePath]).toEqual(['grok_error', true, wt]);
    expect(r.message).toContain(`git -C '${wt}' reset --soft w1`);
    expect(r.message).toContain('grok_build_worktree');
    expect(r.message).not.toContain(`git -C '${dirA}'`);
  });

  it('a resume that committed in both folders names both', async () => {
    const r = await run2({ resumeSessionId: SID }, done, { [dirA]: ['a1', 'a2'], [dirB]: ['b1', 'b2'] });
    expect(r.message).toContain(`git -C '${dirA}' reset --soft a1`);
    expect(r.message).toContain(`git -C '${dirB}' reset --soft b1`);
  });

  it('a plan that rewrote a file and then timed out says so (planWroteFiles on every ending)', async () => {
    let p = 0;
    const r = await run2({ plan: true }, timeout, { [dirA]: ['a', 'a'] }, { gitDirtyFingerprint: async () => (p++ === 0 ? 'x1' : 'x2') });
    expect([r.status, r.planWroteFiles, r.committed]).toEqual(['timeout', true, false]);
    expect(r.message).toMatch(/plan은 읽기 전용이어야 하지만 작업 트리가 변경됐습니다/);
  });

  it('a timed-out resume or continue does not promise a session id it does not return', async () => {
    const resumed = await run2({ resumeSessionId: SID }, timeout, { [dirA]: ['a', 'a'] });
    expect([resumed.sessionId, resumed.message]).toEqual([undefined, expect.not.stringMatching(/sessionId로/)]);
    const continued = await run2({ continueSession: true }, timeout, { [dirA]: ['a', 'a'] });
    expect([continued.sessionId, continued.message]).toEqual([undefined, expect.not.stringMatching(/sessionId로/)]);
    const fresh = await run2({}, timeout, { [dirA]: ['a', 'a'] });
    expect(fresh.message).toMatch(/sessionId로/);
    expect(fresh.sessionId).toBeTruthy();
  });

  // The folder was known before the run (the session is the requested cwd's own), so HEAD there IS the verification.
  it('a resume in the requested folder keeps its measured "no commit"', async () => {
    const r = await run2({ resumeSessionId: SID }, done, { [dirA]: ['a', 'a'] }, { sessionsIndex: sessionsIndex(dirA) });
    expect([r.resumedCwd, r.committed]).toEqual([undefined, false]);
  });

  it('a plan that could not be checked no longer blames the cwd for not being a git repo', async () => {
    const r = await run2({ plan: true }, { code: 0, stdout: JSON.stringify({ text: 'the plan', stopReason: 'end_turn' }) }, { [dirA]: [null, null] },
      { gitDirtyFingerprint: async () => null });
    expect(r.planWroteFiles).toBeUndefined();
    expect(r.message).not.toMatch(/cwd가 git 저장소가 아닙니다/);
  });

  // v0.2.37 pre-merge review, round 2 (on a4005a3). The fingerprint is null not only outside a repo: git's 10 s
  // timeout and an oversized diff give null too, while HEAD still reads — the result said `committed: false` (a repo
  // with a commit) and, beside it, "not a git repo or no commits". MEASURED on a4005a3 with a repo missing a blob.
  it('a plan whose tree could not be read, where HEAD was read, does not say the folder is not a repo', async () => {
    const r = await run2({ plan: true }, { code: 0, stdout: JSON.stringify({ text: 'the plan', stopReason: 'end_turn' }) }, { [dirA]: ['h', 'h'] },
      { gitDirtyFingerprint: async () => null });
    expect([r.committed, r.planWroteFiles]).toEqual([false, undefined]);
    expect(r.message).toMatch(/확인할 수 없었습니다/);
    expect(r.message).not.toMatch(/아니거나 커밋이 없습니다/);
    // Round 3: the causes stay possibilities ("수 있습니다"), and a git failure is among them — the measured case (a
    // missing blob) was none of the four listed before.
    expect(r.message).toMatch(/git이 실패했거나.*수 있습니다\)/);
    // Round 4: every cause on that line is pinned, not only the one this round added.
    for (const cause of ['git 저장소가 아니거나', '커밋이 없거나', '오류·출력 한도', '제시간에 답하지 못했을']) expect(r.message).toContain(cause);
  });

  // Round 2: the notice put the folder raw inside DOUBLE quotes. MEASURED on a4005a3 by pasting the notice's own text
  // into Git Bash and PowerShell 5.1: for a folder `a$b` beside a clone `a`, `reset --soft` undid the USER'S commit in
  // `a`; `$(mkdir PWNED)` ran; a trailing backslash left the quote open (bash) or folded the rest of the command into
  // -C (PowerShell 5.1 with a space in the path); a backtick became a TAB. Single quotes are literal in both shells.
  it('renders a folder for a pasted command only in a form bash and PowerShell both read literally', () => {
    expect(shellDir('/tmp/a$b/repo', 'linux')).toBe(`'/tmp/a$b/repo'`);
    expect(shellDir('/tmp/p $(mkdir PWNED)', 'linux')).toBe(`'/tmp/p $(mkdir PWNED)'`);
    expect(shellDir('/tmp/a`tb', 'darwin')).toBe("'/tmp/a`tb'");
    expect(shellDir('/tmp/Jane Doe/repo', 'linux')).toBe(`'/tmp/Jane Doe/repo'`);
    // win32: forward slashes, which git accepts — a trailing backslash can then never eat the closing quote when
    // PowerShell 5.1 re-quotes a native argument that has a space, and a UNC path keeps both its leading slashes.
    expect(shellDir('C:\\Users\\Jane Doe\\repo\\', 'win32')).toBe(`'C:/Users/Jane Doe/repo/'`);
    expect(shellDir('\\\\server\\share\\repo', 'win32')).toBe(`'//server/share/repo'`);
    expect(shellDir('D:\\src\\$proj\\repo', 'win32')).toBe(`'D:/src/$proj/repo'`);
    // A backslash is an ordinary character in a POSIX name — never rewritten there, on any POSIX platform.
    expect(shellDir('/tmp/a\\b', 'linux')).toBe(`'/tmp/a\\b'`);
    expect(shellDir('/Users/x/a\\b', 'darwin')).toBe(`'/Users/x/a\\b'`);
    // No quoting survives a single quote in both shells (bash has no escape inside '…', PowerShell doubles it), and
    // PowerShell also closes a single-quoted string on the typographic quotes U+2018..U+201B; a control character
    // breaks the line the command is shown on. Those get no inline command — anywhere in the name, the last place too.
    const forbidden = [0x27, 0x2018, 0x2019, 0x201a, 0x201b, 0x7f, ...Array.from({ length: 0x20 }, (_, i) => i)];
    for (const c of forbidden) {
      for (const dir of [`/tmp/a${String.fromCharCode(c)}b`, `/tmp/a${String.fromCharCode(c)}`]) {
        expect(shellDir(dir, 'linux'), JSON.stringify(dir)).toBeUndefined();
      }
    }
    // …and only those: the typographic DOUBLE quotes U+201C..U+201F are literal inside '…' in both shells (measured).
    for (const c of [0x201c, 0x201d, 0x201e, 0x201f, 0x20]) {
      const dir = `/tmp/a${String.fromCharCode(c)}b`;
      expect(shellDir(dir, 'linux'), JSON.stringify(dir)).toBe(`'${dir}'`);
    }
  });

  // Round 3: a rooted win32 path with no drive went out as `/Users/…`, which Git Bash's path conversion rewrote to
  // `C:/Program Files/Git/Users/…` (measured: exit 128). It gets the root the server resolved it against (the cwd's
  // drive, or its share on a UNC cwd). Only win32 can say which root that is, so the exact expectation runs there (the
  // Windows CI job).
  it.skipIf(process.platform !== 'win32')('a win32 folder with no drive is named with the root it was resolved on', () => {
    // Round 4: the rendered folder must be the SAME directory the file system reaches from this process for the
    // drive-less name — a real folder on this process's drive, compared by inode (skipped on a UNC cwd, which has no
    // drive to strip). Round 5: on a drive-letter cwd that cannot tell "cwd's drive + path" from the real resolution
    // (both agree there); only a UNC cwd separates them — the root is then the share. A stubbed UNC cwd pins it
    // (win32.resolve reads process.cwd(); measured: the formula gives `'///Users/x/repo'`).
    if (/^[A-Za-z]:/.test(process.cwd())) {
      const onCwdDrive = tmpdir().slice(0, 2).toLowerCase() === process.cwd().slice(0, 2).toLowerCase() ? tmpdir() : process.cwd();
      const real = mkdtempSync(join(onCwdDrive, 'sd-drive-'));
      try {
        const driveless = real.slice(2);
        const rendered = shellDir(driveless, 'win32')!;
        expect(rendered).toMatch(/^'[A-Za-z]:\//);
        expect(statSync(rendered.slice(1, -1)).ino).toBe(statSync(driveless).ino);
        expect(shellDir(driveless.split('\\').join('/'), 'win32')).toBe(rendered);
      } finally {
        rmSync(real, { recursive: true, force: true });
      }
    }
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue('\\\\srv\\share\\proj');
    try {
      expect(shellDir('\\Users\\x\\repo', 'win32')).toBe(`'//srv/share/Users/x/repo'`);
      expect(shellDir('/Users/x/repo', 'win32')).toBe(`'//srv/share/Users/x/repo'`);
    } finally {
      cwd.mockRestore();
    }
    // UNC and device paths already say where they are — Git Bash leaves `//…` alone (measured).
    expect(shellDir('\\\\server\\share\\repo', 'win32')).toBe(`'//server/share/repo'`);
    expect(shellDir('\\\\?\\C:\\x', 'win32')).toBe(`'//?/C:/x'`);
  });

  // Round 3 (differential reviewer): the win32 half of the notice was never exercised through runDelegate — a
  // commitNotice that rendered the folder in POSIX form passed every test and brought back PowerShell 5.1's trailing-
  // backslash failure. The expectation is literal, not shellDir's own output.
  it.skipIf(process.platform !== 'win32')('on win32 the notice names a backslash folder with forward slashes', async () => {
    const dir = 'C:\\Users\\Jane Doe\\repo\\';
    const r = await run2({ cwd: dir }, exit1, { [dir]: ['a1', 'a2'] });
    expect(r.committed).toBe(true);
    expect(r.message).toContain("git -C 'C:/Users/Jane Doe/repo/' log --stat a1..HEAD");
    expect(r.message).toContain("git -C 'C:/Users/Jane Doe/repo/' reset --soft a1");
    expect(r.message).not.toContain("'C:\\Users");
  });

  it.each([['/tmp/a$b'], ['/tmp/p $(mkdir PWNED)'], ['/tmp/a`tb']])('a commit notice for %s names it in single quotes', async (raw) => {
    const dir = onDrive(raw);
    const r = await run2({ cwd: dir }, exit1, { [dir]: ['a1', 'a2'] });
    expect(r.committed).toBe(true);
    expect(r.message).toContain(`git -C '${dir}' log --stat a1..HEAD`);
    expect(r.message).toContain(`git -C '${dir}' reset --soft a1`);
    expect(r.message).not.toContain('git -C "');
  });

  it('a folder no quoting survives is named, with the commands to run inside it', async () => {
    const dir = "/tmp/it's";
    const r = await run2({ cwd: dir }, exit1, { [dir]: ['a1', 'a2'] });
    expect(r.committed).toBe(true);
    expect(r.message).toContain(dir);
    expect(r.message).not.toContain('git -C');
    // Round 3: "inside that folder" is the whole point — a bare `git reset --soft` typed in the project undoes the
    // user's commit (the A49 hazard). Pinned before each command.
    expect(r.message).toContain('그 폴더 안에서 `git log --stat a1..HEAD`');
    expect(r.message).toContain('그 폴더 안에서 `git reset --soft a1`');
  });

  // Round 2 (the differential reviewer): mutants that each changed what a user reads survived the whole suite. Each
  // test below is the one that kills a named mutant; the behaviour was already right.
  const notFound = { sessionsIndex: { listSessionDirs: () => [], sessionDirHasId: () => false } };
  const planDone = { code: 0, stdout: JSON.stringify({ text: 'the plan', stopReason: 'end_turn', sessionId: SID }) };
  const authFail = { code: 1, stdout: '', stderr: 'invalid or expired credentials' };

  it.each([
    ['completed delegate', {}, done], ['failed delegate', {}, exit1], ['timed-out delegate', {}, timeout],
    ['completed plan', { plan: true }, planDone], ['failed plan', { plan: true }, exit1], ['timed-out plan', { plan: true }, timeout],
  ] as const)('a worktree commit carries the diff/apply caveat on every ending (%s)', async (_l, how, ending) => {
    const wt = wtDir;
    const r = await run2({ worktree: true, ...how }, ending, { [wt]: ['w1', 'w2'] }, { createWorktree: async () => wt });
    expect(r.committed).toBe(true);
    expect(r.message).toContain(`git -C '${wt}' reset --soft w1`);
    expect(r.message!.split('grok_build_worktree').length - 1).toBe(1);
  });

  it('the worktree caveat is only on the worktree folder', async () => {
    const wt = wtDir;
    const r = await run2({ worktree: true, resumeSessionId: SID }, done, { [dirA]: ['a1', 'a2'] },
      { createWorktree: async () => wt, sessionsIndex: sessionsIndex(dirA) });
    expect([r.committed, r.resumedCwd]).toEqual([true, dirA]);
    expect(r.message).toContain(`git -C '${dirA}' reset --soft a1`);
    expect(r.message).not.toContain('grok_build_worktree');
  });

  it.each([
    ['resume not in the index', { resumeSessionId: SID }, notFound],
    ['continue that went elsewhere', { continueSession: true }, {}],
  ] as const)('an unlocated plan keeps a write it saw (%s)', async (_l, how, extra) => {
    let p = 0;
    const r = await run2({ plan: true, ...how }, planDone, { [dirA]: ['a', 'a'] },
      { ...extra, gitDirtyFingerprint: async () => (p++ === 0 ? 'x1' : 'x2') });
    expect([r.planWroteFiles, r.committed]).toEqual([true, undefined]);
  });

  it.each([
    ['continue', { continueSession: true }, {}],
    ['resume not in the index', { resumeSessionId: SID }, notFound],
  ] as const)('an unlocated run keeps the failure\'s own message first (%s)', async (_l, how, extra) => {
    for (const [ending, head] of [
      [exit1, 'Grok Build가 결과를 반환하지 않았습니다'],
      [timeout, 'Grok Build 작업이 '],
      [authFail, '구독 세션 인증이 필요/만료됐습니다'],
    ] as const) {
      const r = await run2(how, ending, { [dirA]: ['a', 'a'] }, extra);
      expect(r.committed).toBeUndefined();
      expect(r.message!.startsWith(head), r.message).toBe(true);
      expect(r.message).toMatch(/확인하지 못했습니다/);
    }
  });

  it.each([[['b1', 'b1']], [['b1', null]], [[null, 'b1']]] as const)('only a folder whose HEAD was read to move is named (B %j)', async (pair) => {
    const r = await run2({ resumeSessionId: SID }, done, { [dirA]: ['a1', 'a2'], [dirB]: pair as unknown as [string, string] });
    expect(r.committed).toBe(true);
    expect(r.message).toContain(`git -C '${dirA}' reset --soft a1`);
    expect(r.message).not.toContain(`git -C '${dirB}'`);
    expect(r.message).not.toContain(`${dirB}의 HEAD`);
  });

  // Round 2's refuted item, kept: its mutant (`||` -> `&&` in changedIn) survived every revision's suite, main's too.
  it.each([[['aaa', null]], [[null, 'aaa']]] as const)('a HEAD read on one side only is not a move (%j)', async (pair) => {
    const r = await run2({}, done, { [dirA]: pair as unknown as [string, string] });
    expect(r.committed).toBeUndefined();
    expect(r.message ?? '').not.toMatch(/커밋을 만들었습니다/);
  });

  it.each([['exit 1', exit1], ['timed out', timeout], ['auth', authFail]] as const)(
    'a failed plan that wrote nothing says so (%s)', async (_l, ending) => {
      const r = await run2({ plan: true }, ending, { [dirA]: ['a', 'a'] });
      expect([r.planWroteFiles, r.committed]).toEqual([false, false]);
    });

  it.each([
    ['delegate', {}, '이 위임이 git 커밋을', '이 실행이 git 커밋을'],
    ['plan', { plan: true }, 'plan은 읽기 전용이어야 하지만 이 실행이 git 커밋을', '이 위임이 git 커밋을'],
  ] as const)('the commit notice says which kind of run made it (%s)', async (_l, how, lead, other) => {
    for (const ending of [done, exit1, timeout]) {
      const r = await run2(how, ending, { [dirA]: ['a', 'b'] });
      expect(r.message!.split(lead).length - 1).toBe(1);
      expect(r.message).not.toContain(other);
    }
  });

  it.each([['exit 1', exit1], ['timed out', timeout]] as const)(
    'a failed plan that committed points at the commit, not at git status (%s)', async (_l, ending) => {
      const r = await run2({ plan: true }, ending, { [dirA]: ['a', 'b'] });
      expect([r.planWroteFiles, r.committed]).toEqual([true, true]);
      expect(r.message).toContain(`git -C '${dirA}' reset --soft a`);
      expect(r.message).not.toMatch(/git status/);
    });

  // headsBy counts reads per folder, so reading one folder twice is invisible to it; this stub keys on the spawn.
  it('a resume in the requested folder is read, and named, once', async () => {
    let spawned = false;
    const r = await runDelegate('subscription', { prompt: 'p', cwd: dirA, resumeSessionId: SID }, {
      spawn: async () => {
        spawned = true;
        return { code: 0, stdout: JSON.stringify({ text: 'done', stopReason: 'end_turn', sessionId: SID }), stderr: '', timedOut: false };
      },
      dirExists: () => true,
      gitChangedFiles: async () => [],
      gitHead: async () => (spawned ? 'a2' : 'a1'),
      sessionsIndex: sessionsIndex(dirA),
      env: {},
    } as never);
    expect([r.committed, r.resumedCwd]).toEqual([true, undefined]);
    expect(r.message!.split('reset --soft a1').length - 1).toBe(1);
  });

  it('an unlocated plan drops a "wrote nothing" it cannot attribute, even with HEAD unreadable', async () => {
    const r = await run2({ resumeSessionId: SID, plan: true }, planDone, { [dirA]: [null, null] }, notFound);
    expect([r.committed, r.planWroteFiles]).toEqual([undefined, undefined]);
    expect(r.message).toMatch(/확인하지 못했습니다/);
  });

  // …and a `continue` names its folder only after the run, so there is no "before" there to compare: HEAD unchanged
  // in the requested folder is then no verification of the folder grok worked in.
  it('a continue that ran in another folder does not claim "no commit"', async () => {
    const r = await runDelegate('subscription', { prompt: 'p', cwd: dirA, continueSession: true }, {
      spawn: async () => ({ code: 0, stdout: JSON.stringify({ text: 'done', stopReason: 'end_turn', sessionId: SID }), stderr: '', timedOut: false }),
      dirExists: () => true,
      gitChangedFiles: async () => [],
      gitHead: headsBy({ [dirA]: ['a1', 'a1'] }),
      sessionsIndex: sessionsIndex(dirB),
      env: {},
    } as never);
    expect([r.status, r.resumedCwd, r.committed]).toEqual(['completed', dirB, undefined]);
  });

  it('reports resumedCwd and the files it really touched when they differ', async () => {
    let dirBCalls = 0;
    const r = await runDelegate('subscription', { prompt: 'p', cwd: dirA, resumeSessionId: SID }, {
      spawn: async () => ({ code: 0, stdout: JSON.stringify({ text: 'done', stopReason: 'end_turn', sessionId: SID }), stderr: '', timedOut: false }),
      dirExists: () => true,
      // dirB is empty before the spawn and holds a.txt after it — that delta is the run's work.
      gitChangedFiles: (cwd: string) => (sameDirectory(cwd, dirB) ? (dirBCalls++ === 0 ? [] : ['a.txt']) : []),
      sessionsIndex: sessionsIndex(dirB),
      env: {},
    } as never);
    expect(r.status).toBe('completed');
    expect(r.resumedCwd).toBe(dirB);
    expect(r.filesChanged).toEqual(['a.txt']);
    expect(r.message, 'the mismatch must be stated, not inferred from a field').toMatch(/resume/i);
  });

  it('stays quiet when the resumed session belongs to the requested cwd', async () => {
    const r = await runDelegate('subscription', { prompt: 'p', cwd: dirA, resumeSessionId: SID }, {
      spawn: async () => ({ code: 0, stdout: JSON.stringify({ text: 'done', stopReason: 'end_turn', sessionId: SID }), stderr: '', timedOut: false }),
      dirExists: () => true,
      gitChangedFiles: () => ['a.txt'],
      sessionsIndex: sessionsIndex(dirA),
      env: {},
    } as never);
    expect(r.resumedCwd).toBeUndefined();
    expect(r.message).toBeUndefined();
  });

  // A35 (MEASURED 2026-09-24, grok 1.0.41): grok resolves a relative GROK_HOME against the folder
  // it runs in, so a resumed run keeps its sessions under <run folder>/<GROK_HOME>/sessions. The
  // default index looked under the SERVER's folder instead and found nothing, so the relocation
  // above went unreported whenever GROK_HOME was relative.
  it('looks for the session under the run folder when GROK_HOME is relative (A35)', async () => {
    const task = mkdtempSync(join(tmpdir(), 'a35-resume-'));
    try {
      mkdirSync(join(task, 'rel-home', 'sessions', encodeURIComponent(dirB), SID), { recursive: true });
      const r = await runDelegate('subscription', { prompt: 'p', cwd: task, resumeSessionId: SID }, {
        spawn: async () => ({ code: 0, stdout: JSON.stringify({ text: 'done', stopReason: 'end_turn', sessionId: SID }), stderr: '', timedOut: false }),
        dirExists: () => true,
        gitChangedFiles: () => [],
        env: { GROK_HOME: 'rel-home' },
      } as never);
      expect(r.resumedCwd).toBe(dirB);
    } finally {
      rmSync(task, { recursive: true, force: true });
    }
  });

  it('does not probe at all for an ordinary (non-resume) delegation', async () => {
    let probed = 0;
    const r = await runDelegate('subscription', { prompt: 'p', cwd: dirA }, {
      spawn: async () => ({ code: 0, stdout: JSON.stringify({ text: 'done', stopReason: 'end_turn', sessionId: SID }), stderr: '', timedOut: false }),
      dirExists: () => true,
      gitChangedFiles: () => [],
      sessionsIndex: { listSessionDirs: () => (probed++, []), sessionDirHasId: () => false },
      env: {},
    } as never);
    expect(probed).toBe(0);
    expect(r.resumedCwd).toBeUndefined();
  });
});

// A33 — MEASURED 2026-09-23 on Linux (Docker, Debian bookworm, grok CLI 1.0.41), through the
// SHIPPED bundle via .claude/tools/mcpcall.mjs. This closes the Linux half of docs/10 B4.
//
// The run that produced each fixture: grok_build_delegate, prompt "create a file named
// hello.txt containing the word hi", cwd /tmp/work, with GROK_SANDBOX set in the PARENT
// environment and nothing passed by the caller. buildGrokEnv forwards the whole env, and grok
// reads GROK_SANDBOX by itself (`--sandbox <PROFILE> [env: GROK_SANDBOX=]`).
//
// Measured before/after, same payload:
//   before -> message "Grok Build 출력을 해석할 수 없습니다." for all three causes below
//   after  -> the sandbox refusal names itself; the generic case stops asserting a cause
//
// Grok adjudicated the claim "run B's `message` states the cause of the failure correctly"
// and answered CLAIM_FALSE: `message` asserts a parse failure, stderr says grok refused to
// start. Not the same cause, and the true one is unreachable from `message` alone.
describe('A33 — a run that ends without an envelope must not assert a cause it never established', () => {
  // Verbatim rawStderrTail from the measured responses. Do not paraphrase: the point of a
  // fixture is that a regression comes back in the same shape.
  const BWRAP_MISSING = 'error: this sandbox could not enforce its deny list on Linux: bwrap exec failed: No such file or directory (os error 2). Install bubblewrap with `apt install -y bubblewrap`. Refusing to start with denied paths unprotected.\n';
  const BWRAP_DENIED = 'bwrap: Creating new namespace failed: Operation not permitted\n';
  // From raw grok in the same container (not through the bundle): an unknown profile name.
  const PROFILE_UNKNOWN = "error: sandbox profile resolve failed: Custom sandbox profile 'zzz-not-a-profile' not found. Define it in ~/.grok/sandbox.toml or .grok/sandbox.toml:\n";

  for (const [name, stderr] of [
    ['bubblewrap absent', BWRAP_MISSING],
    ['bubblewrap present but namespace denied', BWRAP_DENIED],
    ['profile name not defined', PROFILE_UNKNOWN],
  ] as const) {
    it(`names the sandbox as the cause: ${name}`, async () => {
      const r = await runDelegate('subscription', input, deps({ code: 1, stdout: '', stderr }));
      expect(r.status).toBe('grok_error');
      // The remedy the caller can act on, and the one they cannot guess: an env var they
      // never passed is what changed this run.
      expect(r.message).toMatch(/GROK_SANDBOX/);
      expect(r.message).not.toMatch(/해석할 수 없습니다/);
      expect(r.rawStderrTail).toBe(stderr);
    });
  }

  // FOUND BY GROK 2026-09-23, reviewing this very fix. The first version of the bwrap signal
  // was /^bwrap: /im, and `m` makes `^` match at the start of ANY line — so a delegation in
  // which grok itself ran a `bwrap ...` command as a tool call, and forwarded its stderr, was
  // reported as "grok refused to start over a sandbox". grok had started; it was the user's
  // own command that failed. Asserting an unestablished cause is the defect A33 exists to fix,
  // so shipping a second one inside the fix was exactly the wrong direction.
  //
  // Anchoring to the start of the WHOLE stderr fails to the safe side: a refusal preceded by
  // other output degrades to the generic message, which points at rawStderrTail and claims
  // nothing.
  it('does not read a forwarded bwrap tool failure as a startup refusal', async () => {
    const stderr = 'Running tests...\nbwrap: execvp /usr/bin/pytest: No such file or directory\nFAILED: the sandboxed test command exited 127\n';
    const r = await runDelegate('subscription', input, deps({ code: 1, stdout: '', stderr }));
    expect(r.status).toBe('grok_error');
    expect(r.message).not.toMatch(/GROK_SANDBOX/);
    expect(r.message).toMatch(/rawStderrTail/);
  });

  it('still refuses to name a cause when stderr gives none', async () => {
    const r = await runDelegate('subscription', input, deps({ code: 1, stdout: '', stderr: 'segfault\n' }));
    expect(r.status).toBe('grok_error');
    expect(r.message).toMatch(/rawStderrTail/);
    expect(r.rawStderrTail).toBe('segfault\n');
  });

  // The signals are deliberately stderr-only. A delegation whose ASSISTANT TEXT discusses
  // bubblewrap is not a sandbox refusal, and misclassifying it would hand the user a remedy
  // for a problem they do not have — the same failure mode A33 itself is about.
  it('does not fire on a successful run whose output merely discusses sandboxing', async () => {
    const r = await runDelegate('subscription', input, deps({
      stdout: okJson({ text: 'Added a note about bwrap and the sandbox could not enforce case.' }),
    }, ['notes.md']));
    expect(r.status).toBe('completed');
    expect(r.message).toBeUndefined();
  });

  // Auth outranks the sandbox: a 401 reaches the model layer, so the sandbox cannot have been
  // what stopped it. Measured — the control arm with GROK_SANDBOX unset returns exactly this.
  it('keeps auth classification when stderr is an auth failure, not a sandbox refusal', async () => {
    const stderr = 'Error: Internal error: "Unauthorized (401) from https://cli-chat-proxy.grok.com/v1/responses: Invalid or expired credentials (auth_kind=bearer, x_xai_token_auth=xai-grok-cli, upstream=PermissionDenied, reason=no auth context)"\n';
    const r = await runDelegate('subscription', input, deps({ code: 1, stdout: '', stderr }));
    expect(r.status).toBe('auth_error');
  });
});
