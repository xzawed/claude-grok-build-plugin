import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
import {
  runDelegate, parsePorcelain, diffChangedFiles, validateDelegateOptions, defaultGitChangedFiles,
  appendBounded, STDOUT_CAP_BYTES, STDERR_CAP_BYTES,
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
      const line = tool.split('\n').find((l) => l.includes(`'${t}'`) && l.includes('best_of_n'));
      expect(line, `${t} probe in accept-release.mjs no longer carries best_of_n`).toBeTruthy();
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
