/**
 * The checks accept-release.mjs grades a bundle with, in one protocol era at a time, and the isolation every server
 * and hook they start runs in. A module of its own so a test can run the same checks through another session opener
 * (rpc-era.test.ts: the raw 2026-07-28 session against the SDK client's — MCP 2.0 plan, Task 2.4). The quota promise
 * of accept-release.mjs's header rests on what is here: the env every server starts in, and `best_of_n` on the
 * delegate, plan and verify probes (delegate.test.ts reads these payloads).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { openSession } from './rpc-era.mjs';

// ── where grok cannot be found ─────────────────────────────────────────────
// docs/10 A61 and A76. Every server and hook below starts from this env, in the throwaway folder
// `work`, so the bundle under grade has no grok to start, and no installed grok decides a cell:
// - PATH, under every case variant of the name (Windows env names are case-insensitive), keeps only
//   entries whose folder Node sees as a spawn does, and of those none that holds a file a spawn,
//   `where`/`command -v` or the install probe could take for grok. On Windows that is a plain drive
//   path: libuv's spawn search also takes a quoted entry (single or double quotes, a `;` inside
//   them, an unclosed quote) and Windows drops a lone trailing dot from a folder name, none of which
//   Node's literal lookup sees (measured with a runnable stand-in, 2026-11-05); a UNC entry goes
//   unlooked-at, as an unreachable share stalls each lookup (auth.ts caps where.exe for that) — a
//   drive letter mapped to such a share is still looked up. Elsewhere it is an absolute path — an
//   empty or relative entry is searched from the spawn's folder — looked up with its `..` left to
//   the system, as a spawn does: path.join folds `..` in the text, while a POSIX kernel follows a
//   symlink first (measured in a container: `link/..` reached the folder above the link's target);
// - GROK_BIN_DIR is a throwaway folder holding only an empty file named `grok`. The install probe
//   accepts that name on every platform (grokBinNames), so the cells that need grok "installed"
//   (A2, A7, A35, A36, A56) do not depend on this machine's install, and nothing can run it: a
//   Windows spawn looks only for grok.com and grok.exe, and elsewhere the file is not executable;
// - HOME, USERPROFILE and GROK_HOME are one throwaway folder: older bundles put homedir()/.grok/bin
//   in front of PATH, and before v0.2.12 they read the session from homedir()/.grok;
// - the servers, the hook runs and the probes' `cwd` use the empty folder `work`: a Windows spawn
//   looks in its own folder before PATH (unless NoDefaultCurrentDirectoryInExePath is set).
// The servers used to inherit the parent env and folder as they were, and in a signed-in
// maintainer's home the old bundles started grok through that .grok/bin (measured — the header).
const GROK_FILES = ['grok', 'grok.exe', 'grok.cmd', 'grok.bat', 'grok.com', 'grok.ps1'];

/** The throwaway folders and the env every server and hook starts in. `cleanup()` returns what it could not remove. */
export function isolate() {
  const isolation = mkdtempSync(join(tmpdir(), 'accept-isolation-'));
  const isolatedHome = join(isolation, 'home');
  const placeholderBin = join(isolation, 'bin');
  const work = join(isolation, 'work');
  for (const d of [isolatedHome, placeholderBin, work]) mkdirSync(d);
  writeFileSync(join(placeholderBin, 'grok'), '');
  const plainEntry = process.platform === 'win32'
    ? (d) => /^[A-Za-z]:[\\/]/.test(d) && !/["']/.test(d)
      && d.split(/[\\/]/).every((s) => s === '.' || s === '..' || !/[. ]$/.test(s))
    : (d) => d.startsWith('/');
  const holds = (d, n) => existsSync(process.platform === 'win32' ? join(d, n) : `${d}/${n}`);
  const keptEntry = (d) => plainEntry(d) && !GROK_FILES.some((n) => holds(d, n));
  const baseEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    const name = k.toLowerCase();
    if (['grok_bin_dir', 'grok_home', 'home', 'userprofile'].includes(name)) continue;
    baseEnv[k] = name === 'path' && typeof v === 'string' ? v.split(delimiter).filter(keptEntry).join(delimiter) : v;
  }
  Object.assign(baseEnv, { GROK_BIN_DIR: placeholderBin, GROK_HOME: isolatedHome, HOME: isolatedHome, USERPROFILE: isolatedHome });
  return {
    baseEnv, work, isolation,
    cleanup() {
      // Best effort: Windows refuses to remove a folder a process is still in (EBUSY at once — rmSync's maxRetries
      // did not retry it, Node 22.18, measured), so a folder left here is reported, not thrown.
      try { rmSync(isolation, { recursive: true, force: true }); return []; } catch (e) { return [`${isolation} (${e?.code ?? e})`]; }
    },
  };
}

// ── sessions ───────────────────────────────────────────────────────────────
/**
 * The grader's session opener over raw JSON-RPC lines (rpc-era.mjs), for one era: `(server, env, cwd)` → a session
 * with `call(name, args)` → `{ isError, text, raw }`, `listTools()` and `close()` (settles once the server is gone:
 * it runs in `work`, which Windows does not remove while a process is in it). Rejects with `notServed` when the
 * bundle does not serve the era.
 */
export function rawOpener(era) {
  return async (server, env, cwd) => {
    const child = spawn(process.execPath, [server], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env, cwd });
    const gone = new Promise((resolve) => { child.once('exit', resolve); child.once('error', resolve); });
    try {
      const s = await openSession(child, era, { clientInfo: { name: 'accept', version: '0' } });
      return {
        async call(name, args_) {
          const j = await s.request('tools/call', { name, arguments: args_ });
          return { isError: Boolean(j.result?.isError), text: j.result?.content?.[0]?.text ?? '', raw: j };
        },
        async listTools() {
          const j = await s.request('tools/list', {});
          return j.result?.tools ?? [];
        },
        close() { child.kill(); return gone; },
      };
    } catch (e) {
      child.kill();
      await gone;
      throw e;
    }
  };
}

export function runHook(hook, iso, payload, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [hook], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, cwd: iso.work,
      env: { ...iso.baseEnv, ...env },
    });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', () => resolve(out.trim()));
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export function runServerWithBadMode(server, iso) {
  return new Promise((resolve) => {
    const env = { ...iso.baseEnv, GROK_BUILD_AUTH_MODE: 'nonsense-for-acceptance' };
    const child = spawn(process.execPath, [server], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env, cwd: iso.work });
    let err = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, err: err.trim() }));
    child.stdin.end();
  });
}

// ── checks ─────────────────────────────────────────────────────────────────
/**
 * Grade `server` (with `hook`) in one era through `open`. Resolves to `{ rows, leftBehind }` — each row
 * `{ id, what, pass, evidence }`, in the order accept-release has always printed them — or to
 * `{ notServed: true, reason }` when the bundle does not serve the era. `includeEraFree` adds the three checks that
 * open no MCP session (A7 and A2 run the hook; A12 a server that refuses to start); accept-release runs them once.
 */
export async function gradeEra({ era, server, hook, iso, expected, open, includeEraFree }) {
  const rows = [];
  const check = (id, what, pass, evidence) => rows.push({ id, what, pass, evidence });
  const work = iso.work;
  // A34: GROK_BUILD_WORKER makes the bundle refuse every tool. The graded session must look like the one a user
  // runs, so the marker is removed even if this script itself runs inside a grok worker; the A34 check below sets it
  // on purpose, on a session of its own.
  const mcpSession = (extraEnv = {}) => {
    const env = { ...iso.baseEnv, ...extraEnv };
    if (!('GROK_BUILD_WORKER' in extraEnv)) delete env.GROK_BUILD_WORKER;
    return open(server, env, work);
  };
  let session;
  try {
    session = await mcpSession();
  } catch (e) {
    if (e?.notServed) return { notServed: true, reason: e.message };
    throw e;
  }
  // A grok home with no auth.json, so the hook's subscription branch has something to deny on.
  const emptyGrokHome = mkdtempSync(join(tmpdir(), 'accept-grokhome-'));

  try {
    // identity — everything below is meaningless if this grades the wrong artifact
    {
      const r = await session.call('grok_auth_check', {});
      const v = JSON.parse(r.text).serverVersion;
      check('identity', `bundle reports ${expected}`, v === expected, `serverVersion=${v}`);
    }

    if (includeEraFree) {
      // A7 — the PreToolUse deny branch must be armed in the SHIPPED configuration (no env set). The
      // deny must be the logged-out one, which names `grok login`: a hook that cannot find grok denies
      // too, with the install hint, and that passed here without this branch running (A76).
      {
        const denied = await runHook(hook, iso,
          { tool_name: 'mcp__plugin_grok_grok-build__grok_build_delegate', tool_input: { task: 'x' } },
          { GROK_BUILD_AUTH_MODE: undefined, GROK_HOME: emptyGrokHome },
        );
        const loggedOut = denied.includes('"deny"') && denied.includes('grok login');
        const reason = (() => {
          try { return String(JSON.parse(denied).hookSpecificOutput?.permissionDecisionReason ?? denied); } catch { return denied; }
        })();
        check('A7', 'hook denies a delegation while logged out, with no env set', loggedOut,
          !denied ? 'NO OUTPUT (branch not armed)'
            : loggedOut ? 'deny emitted, naming `grok login`' : `NOT the logged-out deny: ${reason.slice(0, 90)}`);
      }

      // A7/A2 — and must NOT block the read-only commands you run to diagnose being logged out
      {
        const out = await runHook(hook, iso,
          { tool_name: 'mcp__plugin_grok_grok-build__grok_cli', tool_input: { args: ['--version'] } },
          { GROK_BUILD_AUTH_MODE: undefined, GROK_HOME: emptyGrokHome },
        );
        check('A2', 'hook lets a read-only grok_cli query through while logged out',
          out === '', out === '' ? 'allowed' : `DENIED: ${out.slice(0, 80)}`);
      }
    }

    // A21 — every tool enforces the additionalProperties:false it publishes
    {
      const cases = [
        ['grok_auth_check', {}],
        // best_of_n is refused before anything spawns (removed in CLI 1.0). On a bundle that
        // already has the fix the call dies on the unknown key; on one that does not, the key is
        // stripped and best_of_n stops it anyway. Without this the probe would run a REAL
        // delegation against exactly the bundles it is meant to catch — measured, it hung for 30s.
        ['grok_build_delegate', { prompt: 'x', cwd: work, best_of_n: 2 }],
        ['grok_build_plan', { prompt: 'x', cwd: work, best_of_n: 2 }],
        ['grok_build_verify', { prompt: 'x', cwd: work, best_of_n: 2 }],
        ['grok_build_usage', {}],
        ['grok_build_status', {}],
        ['grok_build_worktree', { action: 'list', cwd: work }],
        ['grok_build_route', { task: 'x' }],
        ['grok_cli', { args: ['--version'] }],
      ];
      const accepted = [];
      for (const [name, base] of cases) {
        const r = await session.call(name, { ...base, totally_bogus: 1 });
        // The refusal names the key in both SDK formats: up to 1.29.0 the text was the zod issues as
        // JSON (`"code": "unrecognized_keys"`, `"keys": ["totally_bogus"]`); from 1.30.0 it reads
        // "Unrecognized key(s) in object: 'totally_bogus'". MEASURED 2026-10-09 (v0.2.41, SDK 1.32.1):
        // matching the old code alone failed all nine tools while every one still refused. SDK v2 (2.4.0) still
        // matches in both eras (MEASURED 2026-11-28, MCP 2.0 plan Task 2.4).
        const refused = r.isError && r.text.includes('totally_bogus') && /unrecognized_keys|Unrecognized key/.test(r.text);
        if (!refused) accepted.push(name);
      }
      check('A21', 'all 9 tools refuse an unknown key', accepted.length === 0,
        accepted.length ? `still accepting: ${accepted.join(', ')}` : '9/9 refused');
    }

    // A21 — and a typo on an isolation flag is refused rather than silently run without isolation
    {
      // best_of_n for the same reason as above: on a pre-fix bundle `worktreee` is stripped and
      // this would otherwise become a real delegation.
      const r = await session.call('grok_build_delegate', { prompt: 'x', cwd: work, worktreee: true, best_of_n: 2 });
      check('A21', 'a typo on `worktree` is refused, not silently ignored',
        r.isError && r.text.includes('worktreee'), r.isError ? 'refused by name' : 'ACCEPTED — would run without isolation');
    }

    // A14 — plan takes the same fields as verify (schema advertised == schema meant)
    {
      const tools = await session.listTools();
      // Code-unit order, the same on every machine: the two lists are compared, not shown.
      const byCodeUnit = (a, b) => (a < b ? -1 : Number(a > b));
      const props = (n) => Object.keys(tools.find((t) => t.name === n)?.inputSchema?.properties ?? {}).sort(byCodeUnit);
      const plan = props('grok_build_plan');
      const verify = props('grok_build_verify');
      // Non-empty too: this reads the SDK's JSON Schema output, and two empty lists are equal — a schema
      // that lost `properties` would pass as "plan=0 verify=0" (review of v0.2.41's SDK bump).
      check('A14', 'plan advertises the same fields as verify',
        plan.length > 0 && JSON.stringify(plan) === JSON.stringify(verify), `plan=${plan.length} verify=${verify.length}`);
    }

    // A11 + A10 — an unknown subcommand is refused without spawning, and reads as an error
    {
      const t0 = Date.now();
      const r = await session.call('grok_cli', { args: ['sesions'] });
      const ms = Date.now() - t0;
      const body = (() => { try { return JSON.parse(r.text); } catch { return {}; } })();
      check('A11', 'a one-word typo is blocked without spawning (was a 60s timeout)',
        body.status === 'blocked' && ms < 10_000, `status=${body.status} in ${ms}ms`);
      check('A10', 'a blocked command reads as isError', r.isError === true, `isError=${r.isError}`);
    }

    // A17 — an empty SCOPED result must not read as an empty history
    {
      const nowhere = join(tmpdir(), 'accept-no-history-here');
      const r = await session.call('grok_build_usage', { cwd: nowhere });
      const headline = JSON.parse(r.text).insights?.headline ?? '';
      check('A17', 'a cwd-scoped empty result names the directory',
        headline.includes(nowhere) || headline.includes('디렉터리'),
        headline.slice(0, 90));
    }

    if (includeEraFree) {
      // A12 — a bad mode env produces one actionable line, not a stack
      const { code, err } = await runServerWithBadMode(server, iso);
      const oneLine = err.split('\n').length === 1 && !err.includes('    at ');
      check('A12', 'an invalid GROK_BUILD_AUTH_MODE gives one line and exit 1',
        code === 1 && oneLine, `exit=${code} lines=${err.split('\n').length}`);
    }

    // A34 — the copy of this server that grok starts inside a worker must refuse. The payload is the
    // reproduction's nested call (plus best_of_n, in the throwaway `work` folder). An OLD bundle must
    // still spend and write nothing,
    // and bundles disagree about where they look for credentials: from v0.2.12 auth follows
    // GROK_HOME, before that it read homedir()/.grok (review finding). So every home points at a
    // throwaway directory — the auth pre-check fails on any version, before a spawn or a history row.
    // best_of_n stays as another stop, as on the A21 probes.
    {
      const worker = await mcpSession({
        GROK_BUILD_WORKER: '1', GROK_BUILD_AUTH_MODE: 'subscription',
        GROK_HOME: emptyGrokHome, HOME: emptyGrokHome, USERPROFILE: emptyGrokHome,
      });
      try {
        const r = await worker.call('grok_build_delegate', { prompt: 'Create a file named nested.txt containing the single word hi. Do nothing else.', cwd: work, timeout_ms: 150000, best_of_n: 2 });
        const reason = (() => { try { return JSON.parse(r.text).reason; } catch { return undefined; } })();
        check('A34', 'inside a grok worker, a nested delegation is refused',
          r.isError === true && reason === 'inside_grok_worker', `isError=${r.isError} reason=${reason ?? '(none)'}`);
      } finally {
        await worker.close();
      }
    }

    // v0.2.33 billingCaveat — a model given its own key in grok's config.toml is reported beside
    // `billing`, by model id only (docs/specs/2026-09-24-config-model-keys-billing-caveat.md). Asked
    // through grok_build_status, which spawns nothing, so this stays quota-free on every bundle. The
    // key is fabricated and every home points at a throwaway directory: no real config.toml is read.
    {
      const caveatHome = mkdtempSync(join(tmpdir(), 'accept-caveat-'));
      const FAKE_KEY = 'xai-accept-release-fake-key';
      writeFileSync(join(caveatHome, 'config.toml'), `[model."accept-probe"]\napi_key = "${FAKE_KEY}"\n`);
      // Opened inside the try, here and in the cells below: an open can fail (it is asynchronous since the 2026 era
      // came), and the finally must still remove the folder (review of PR #231).
      let s;
      try {
        s = await mcpSession({
          GROK_BUILD_AUTH_MODE: 'subscription',
          GROK_HOME: caveatHome, HOME: caveatHome, USERPROFILE: caveatHome,
        });
        const r = await s.call('grok_build_status', {});
        const caveat = (() => { try { return JSON.parse(r.text).billingCaveat; } catch { return undefined; } })();
        const named = caveat?.reason === 'config_model_keys'
          && (caveat.models ?? []).some((m) => m.model === 'accept-probe' && m.via === 'api_key');
        check('caveat', 'a config.toml model key is reported beside billing, without its value',
          Boolean(named) && !r.text.includes(FAKE_KEY),
          caveat ? `reason=${caveat.reason} models=${(caveat.models ?? []).map((m) => m.model).join(',')}` : 'no billingCaveat');
      } finally {
        await s?.close();
        rmSync(caveatHome, { recursive: true, force: true });
      }
    }

    // v0.2.40 A51 — a model with no key of its own that names a [model_providers.<id>] table through
    // model_provider sends that provider's key (contract §10 "[model_providers] 상속", measured), and the
    // caveat reports it, naming the provider in its message. Same quota-free route as the cell above. The
    // second model names a variable of its own that is not set: grok then sends no config.toml key
    // (measured — not the provider's either), so reporting it would be a false alarm. That variable is
    // removed from the server's env (spawn drops an undefined value, as the A7 cell relies on), so a
    // parent env that happens to set it cannot flip the cell. The response must keep its v0.2.33 shape:
    // the provider is named in the message only, never as a field of `models`.
    {
      const a51Home = mkdtempSync(join(tmpdir(), 'accept-a51-'));
      const FAKE_KEY = 'xai-accept-release-provider-fake-key';
      writeFileSync(join(a51Home, 'config.toml'), [
        '[model_providers.accept-gw]', `api_key = "${FAKE_KEY}"`, '',
        '[model."accept-inherits"]', 'model_provider = "accept-gw"', '',
        '[model."accept-own-env"]', 'env_key = "ACCEPT_RELEASE_A51_UNSET"', 'model_provider = "accept-gw"', '',
      ].join('\n'));
      let s;
      try {
        s = await mcpSession({
          GROK_BUILD_AUTH_MODE: 'subscription',
          GROK_HOME: a51Home, HOME: a51Home, USERPROFILE: a51Home,
          ACCEPT_RELEASE_A51_UNSET: undefined,
        });
        const r = await s.call('grok_build_status', {});
        const caveat = (() => { try { return JSON.parse(r.text).billingCaveat; } catch { return undefined; } })();
        const listed = caveat?.models ?? [];
        const models = listed.map((m) => m.model);
        check('A51', 'a key a model inherits from [model_providers] is reported, naming the provider, without its value',
          caveat?.reason === 'config_model_keys' && models.length === 1 && models[0] === 'accept-inherits'
            && listed.every((m) => !('provider' in m))
            && String(caveat.message).includes('[model_providers."accept-gw"]') && !r.text.includes(FAKE_KEY),
          caveat ? `reason=${caveat.reason} models=${models.join(',')}` : 'no billingCaveat');
      } finally {
        await s?.close();
        rmSync(a51Home, { recursive: true, force: true });
      }
    }

    // v0.2.34 A35 — grok resolves a RELATIVE GROK_HOME against the folder it runs in, so the pre-check
    // must answer for the task folder, not the server's. Asked through grok_build_status (spawns no
    // grok). The session file is an empty placeholder — its existence is all the pre-check reads — under
    // a name unique to this run, so the server's own folder cannot hold one by accident. The base env's
    // placeholder answers the grok-installed probe (A76), and GROK_HOME keeps ~/.grok unread.
    {
      const task = mkdtempSync(join(tmpdir(), 'accept-a35-'));
      const rel = `accept-a35-home-${process.pid}`;
      mkdirSync(join(task, rel));
      writeFileSync(join(task, rel, 'auth.json'), '{}');
      let s;
      try {
        s = await mcpSession({ GROK_BUILD_AUTH_MODE: 'subscription', GROK_HOME: rel });
        const inTask = JSON.parse((await s.call('grok_build_status', { cwd: task })).text);
        const bare = JSON.parse((await s.call('grok_build_status', {})).text);
        check('A35', 'a relative GROK_HOME is resolved against the task folder, and status says so',
          inTask.ready === true && bare.ready === false && typeof inTask.grokHomeNote === 'string',
          `ready(task folder)=${inTask.ready} ready(server folder)=${bare.ready} reason=${bare.reason ?? '(none)'} note=${inTask.grokHomeNote ? 'present' : 'absent'}`);
      } finally {
        await s?.close();
        rmSync(task, { recursive: true, force: true });
      }
    }

    // v0.2.35 A36 — on Windows grok opens its session through Windows path normalization, which Node's fs
    // skips: a home written `<dir>.` IS `<dir>` to grok (measured). A trailing SPACE is not normalized — grok
    // is not signed in there either — so the answer stays "not ready", and now says why. The space half runs
    // everywhere, the dot half on win32 only (the rule is Windows'); nothing is reported for a half that did
    // not run. Asked through grok_build_status (spawns no grok); the session file is an empty placeholder.
    {
      const dir = mkdtempSync(join(tmpdir(), 'accept-a36-'));
      const home = join(dir, 'home');
      mkdirSync(home);
      writeFileSync(join(home, 'auth.json'), '{}');
      let spaced;
      let dotted;
      try {
        spaced = await mcpSession({ GROK_BUILD_AUTH_MODE: 'subscription', GROK_HOME: `${home} ` });
        dotted = process.platform === 'win32'
          ? await mcpSession({ GROK_BUILD_AUTH_MODE: 'subscription', GROK_HOME: `${home}.` })
          : undefined;
        const s = JSON.parse((await spaced.call('grok_build_status', {})).text);
        const d = dotted ? JSON.parse((await dotted.call('grok_build_status', {})).text) : undefined;
        check('A36', dotted
            ? 'a GROK_HOME written <dir>. is <dir> as Windows opens it for grok; a trailing space is not, and status says why'
            : 'a GROK_HOME with a trailing space is not the folder without it, and status says why',
          s.ready === false && typeof s.grokHomeNote === 'string' && (d === undefined || d.ready === true),
          `ready("<dir> ")=${s.ready} note=${s.grokHomeNote ? 'present' : 'absent'}`
            + (d ? ` ready("<dir>.")=${d.ready}` : ` (dot half not run on ${process.platform})`));
      } finally {
        await spaced?.close();
        await dotted?.close();
        rmSync(dir, { recursive: true, force: true });
      }
    }

    // v0.2.45 A56 — in subscription mode the pre-check reads only whether auth.json exists (docs/02
    // policies 3 and 5), so a file grok rejects — `{}` here, one of contract §7 D's shapes — still counts:
    // `ok` stays true and the hook still allows. What the fix changed is the claim: the message says the
    // file is there and was not checked, never that the session is ready ("준비됨"), which an older bundle
    // says. Asked through grok_auth_check and the hook, neither of which spawns grok, so this is quota-free
    // on every bundle. GROK_HOME is a throwaway directory, which is where the pre-check looks from v0.2.12
    // (before that it looked under homedir()/.grok — whether the file exists, never its contents — and such
    // a bundle fails this cell either way). The pre-check first asks whether grok is installed, which the
    // base env's placeholder answers (above): the verdict then does not depend on whether, or where, grok
    // is really installed, and nothing it finds can be run.
    {
      const a56Dir = mkdtempSync(join(tmpdir(), 'accept-a56-'));
      const a56Home = join(a56Dir, 'home');
      mkdirSync(a56Home);
      writeFileSync(join(a56Home, 'auth.json'), '{}');
      const env = { GROK_BUILD_AUTH_MODE: 'subscription', GROK_HOME: a56Home };
      let s;
      try {
        s = await mcpSession(env);
        const r = JSON.parse((await s.call('grok_auth_check', {})).text);
        const hookOut = await runHook(hook, iso,
          { tool_name: 'mcp__plugin_grok_grok-build__grok_build_delegate', tool_input: { task: 'x' } }, env);
        const msg = String(r.message);
        check('A56', 'an auth.json grok may reject reads as present and unchecked, not ready; ok and the hook unchanged',
          r.ok === true && msg.includes('검증') && !msg.includes('준비됨') && hookOut === '',
          `ok=${r.ok} hook=${hookOut === '' ? 'allowed' : 'DENIED'} message=${msg.slice(0, 40)}`);
      } finally {
        await s?.close();
        rmSync(a56Dir, { recursive: true, force: true });
      }
    }
  } catch (e) {
    // A check that threw is a check that failed — say so and keep the report readable.
    check('harness', 'all checks ran to completion', false, e instanceof Error ? e.message : String(e));
  } finally {
    await session.close();
  }
  const leftBehind = [];
  try { rmSync(emptyGrokHome, { recursive: true, force: true }); } catch (e) { leftBehind.push(`${emptyGrokHome} (${e?.code ?? e})`); }
  return { rows, leftBehind };
}
