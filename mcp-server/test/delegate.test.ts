import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, renameSync, statSync, existsSync, symlinkSync, utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
import {
  runDelegate, parsePorcelain, diffChangedFiles, validateDelegateOptions, defaultGitChangedFiles,
  appendBounded, STDOUT_CAP_BYTES, STDERR_CAP_BYTES, spawnBounded, defaultGitDirtyFingerprint, readExactly, longCwdHint, spawnErrorCode,
  ARGV_PROMPT_LIMIT_WIN32_UNITS, ARGV_PROMPT_LIMIT_POSIX_BYTES, promptFitsArgv,
  looksLikeAuthFailure, isTimedOutDeviceAuth, resolveSessionCwd, sameDirectory,
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
    expect(r.message).toMatch(/git show HEAD/);
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

// MEASURED 2026-09-05 service audit: grok CLI 1.0.13 ignores --permission-mode plan and writes
// files; --sandbox read-only/strict do not stop it on win32 either. The plugin cannot prevent the
// write, so it must never report a clean tree when one happened.
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
// A suffix is used instead of 1.0.30's `--rules` (which also worked, measured) because `--rules`
// is not in the 1.0.13 snapshot this repo still supports, and an unconditional unknown flag would
// exit 2 on every delegation for a user on an older CLI. The suffix costs a few tokens and cannot
// break a version.
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
    // The failure's own message stays first; the commit is named after it, with how to inspect and undo it.
    expect(r.message).toMatch(/커밋/);
    expect(r.message).toMatch(/git show HEAD/);
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
  const dirA = '/tmp/a3dirA';
  const dirB = '/tmp/a3dirB';

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
    expect(moved.message).toMatch(/git show HEAD/);
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
