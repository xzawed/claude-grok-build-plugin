import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runDelegate, parsePorcelain, diffChangedFiles, validateDelegateOptions, defaultGitChangedFiles,
  appendBounded, STDOUT_CAP_BYTES, STDERR_CAP_BYTES,
  looksLikeAuthFailure, isTimedOutDeviceAuth,
  type SpawnFn, type SpawnResult, type DelegateDeps,
} from '../src/delegate.js';

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

  // M2 — mandatory flags + injection-safe positional args
  it('always passes the mandatory grok flags and passes prompt/cwd as distinct args', async () => {
    let capturedArgs: string[] = [];
    const capSpawn: SpawnFn = async (args) => { capturedArgs = args; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    await runDelegate('subscription', input, { spawn: capSpawn, gitChangedFiles: () => [], dirExists: () => true });
    expect(capturedArgs).toContain('--no-auto-update');
    expect(capturedArgs).toContain('--always-approve');
    expect(capturedArgs[capturedArgs.indexOf('--output-format') + 1]).toBe('json');
    expect(capturedArgs[capturedArgs.indexOf('--cwd') + 1]).toBe(input.cwd);
    expect(capturedArgs).toContain(`--single=${input.prompt}`);
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
    expect(args).toContain('--single=x');
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
    expect(args).toContain('--single=- Refactor the module');
    expect(args).not.toContain('-p');
  });

  it('uses the same shape for an ordinary prompt', async () => {
    const args = await capture('Refactor the module');
    expect(args).toContain('--single=Refactor the module');
  });

  it('keeps multi-line prompts intact', async () => {
    const args = await capture('Do this:\n- one\n- two');
    expect(args).toContain('--single=Do this:\n- one\n- two');
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
