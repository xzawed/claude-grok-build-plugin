import { describe, it, expect } from 'vitest';
import { runDelegate, parsePorcelain, type SpawnFn, type SpawnResult, type DelegateDeps } from '../src/delegate.js';

const okJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ text: 'done', stopReason: 'EndTurn', ...over });
const fakeSpawn = (r: Partial<SpawnResult>): SpawnFn =>
  async () => ({ code: 0, stdout: '', stderr: '', timedOut: false, ...r });
const deps = (spawnR: Partial<SpawnResult>, files: string[] = []): DelegateDeps => ({
  spawn: fakeSpawn(spawnR),
  gitChangedFiles: () => files,
  dirExists: () => true,
});
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
  it('non-JSON stdout with an auth signal maps to auth_error', async () => {
    const r = await runDelegate('subscription', input, deps({ stdout: '', stderr: 'Error: not authenticated' }));
    expect(r.status).toBe('auth_error');
  });
  it('non-JSON stdout without an auth signal maps to grok_error', async () => {
    const r = await runDelegate('subscription', input, deps({ stdout: 'boom', stderr: 'compile failed' }));
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
    expect(capturedEnv?.PATH).toBe('/usr/bin');
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
    expect(capturedArgs[capturedArgs.indexOf('-p') + 1]).toBe(input.prompt);
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
    const capSpawn: SpawnFn = async (args, cwd) => { capturedArgs = args; capturedCwd = cwd; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    const r = await runDelegate('subscription', { prompt: 'do x', cwd: '/abs/repo', worktree: true }, {
      spawn: capSpawn, dirExists: () => true,
      createWorktree: async () => '/wt/path',
      gitChangedFiles: (cwd) => (cwd === '/wt/path' ? ['a.ts'] : []),
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

  // Phase 3 — sandbox pass-through
  it('passes --sandbox <profile> when sandbox is set, and omits it otherwise', async () => {
    let withArgs: string[] = [];
    const cap: SpawnFn = async (args) => { withArgs = args; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    await runDelegate('subscription', { prompt: 'x', cwd: '/tmp/proj', sandbox: 'readonly' }, { spawn: cap, dirExists: () => true, gitChangedFiles: () => [] });
    expect(withArgs[withArgs.indexOf('--sandbox') + 1]).toBe('readonly');
    let noArgs: string[] = [];
    const cap2: SpawnFn = async (args) => { noArgs = args; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    await runDelegate('subscription', { prompt: 'x', cwd: '/tmp/proj' }, { spawn: cap2, dirExists: () => true, gitChangedFiles: () => [] });
    expect(noArgs).not.toContain('--sandbox');
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

  // Phase 3 — self-verification (--check)
  it('check mode appends --check (keeping --always-approve) and stays EndTurn=completed with git files', async () => {
    let args: string[] = [];
    const cap: SpawnFn = async (a) => { args = a; return { code: 0, stdout: okJson({ text: 'done + verified' }), stderr: '', timedOut: false }; };
    const r = await runDelegate('subscription', { prompt: 'x', cwd: '/tmp/proj', check: true }, {
      spawn: cap, dirExists: () => true, gitChangedFiles: () => ['math.js'],
    });
    expect(args).toContain('--check');
    expect(args).toContain('--always-approve');
    expect(r.status).toBe('completed');
    expect(r.summary).toBe('done + verified');
    expect(r.filesChanged).toEqual(['math.js']);
  });
  it('omits --check when check is not set', async () => {
    let args: string[] = [];
    const cap: SpawnFn = async (a) => { args = a; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    await runDelegate('subscription', { prompt: 'x', cwd: '/tmp/proj' }, { spawn: cap, dirExists: () => true, gitChangedFiles: () => [] });
    expect(args).not.toContain('--check');
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
