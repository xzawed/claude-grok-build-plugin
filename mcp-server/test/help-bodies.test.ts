/**
 * Contract for the help-page body comparison (`scripts/help-bodies.mjs`) that probe:contract runs.
 *
 * WHY THIS EXISTS — MEASURED 2026-10-12, re-measured 2026-11-05 with the old binaries. From grok 1.0.44 to 1.0.50 no
 * flag or subcommand name changed, so probe:contract (names only) reported nothing. Five help pages had changed
 * (`clone`, `du`, `memory clear`, `worktree`, `worktree rm`), and two of those were behaviour (A64: `memory clear`
 * deletes whole scope directories; A65: `worktree rm`'s `-f`). The probe now keeps one hash per page. A page also
 * shows the value of a variable that can set one of its options, unless grok hides it (`[env: GROK_AGENT_SECRET=
 * <value>]`, 1.0.70), so the probe reads pages in a bare environment and the hash drops any value that still shows.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  byCodeUnit, normalizeHelp, helpHash, helpReadEnv, helpPages, hashPages, helpBodyDiff, helpBodyReport,
} from '../scripts/help-bodies.mjs';

// `grok memory clear --help` as 1.0.44 and 1.0.50 print it, down to the two option lines that changed (win32 dumps,
// 2026-11-05).
const memoryClear = (workspace: string, global: string) => [
  'Clear memory files (workspace by default)',
  '',
  'Usage: grok memory clear [OPTIONS]',
  '',
  'Options:',
  workspace,
  global,
].join('\n');
const MEMORY_CLEAR_1044 = memoryClear(
  '      --workspace             Clear workspace-scoped memory (MEMORY.md, sessions/, index.sqlite)',
  '      --global                Clear global MEMORY.md',
);
const MEMORY_CLEAR_1050 = memoryClear(
  '      --workspace             Clear workspace-scoped memory (the whole workspace scope directory)',
  '      --global                Clear global memory (the whole global scope directory)',
);

// Lines of 1.0.70 pages that show a variable, as grok prints them with the variable unset (win32 dumps, 2026-11-05):
// the top level (`--sandbox`), `agent serve` (its secret), and `worker start` (`--name`, and `--api-key`, whose
// `CURSOR_API_KEY` value grok hides).
const ENV_LINES = [
  '      --sandbox <PROFILE>',
  '          Sandbox profile for filesystem and network access [env: GROK_SANDBOX=]',
  '          Secret token for client authentication (auto-generated if not provided)',
  '          ',
  '          [env: GROK_AGENT_SECRET=]',
  '      --name <NAME>',
  '          Worker display name shown in Cursor.',
  '          ',
  '          Default: `[cursor_worker].name`, then the hostname.',
  '          ',
  '          [env: CURSOR_WORKER_NAME=]',
  '      --api-key <KEY>',
  '          Cursor API key the worker registers with, in place of your linked Cursor account.',
  '          ',
  '          Needs the agent-host backend (`GROK_AGENT_HOST_BACKEND=1`), as does `--auth-token-file`. Prefer `CURSOR_API_KEY`: other local users can read a key passed here in the process list.',
  '          ',
  '          [env: CURSOR_API_KEY]',
].join('\n');

describe('normalizeHelp / helpHash', () => {
  it('tells the measured 1.0.44 and 1.0.50 pages apart', () => {
    expect(helpHash(MEMORY_CLEAR_1044)).not.toBe(helpHash(MEMORY_CLEAR_1050));
  });
  it('is the hash the committed baseline was taken with: the first 16 hex of the SHA-256 of the normalized text', () => {
    expect(helpHash(MEMORY_CLEAR_1044)).toBe('e7ffc672e88bd57c');
    expect(helpHash(MEMORY_CLEAR_1050)).toBe('699e1a3f2cd3540f');
  });
  it('ignores line endings, trailing spaces and re-wrapping, not words', () => {
    const crlf = MEMORY_CLEAR_1050.replace(/\n/g, '\r\n');
    const trailing = MEMORY_CLEAR_1050.split('\n').map((l) => `${l}   `).join('\n');
    const rewrapped = MEMORY_CLEAR_1050.replace('(the whole workspace scope directory)', '(the whole\n                              workspace scope directory)');
    for (const variant of [crlf, trailing, rewrapped, `${MEMORY_CLEAR_1050}\n\n`]) expect(helpHash(variant)).toBe(helpHash(MEMORY_CLEAR_1050));
    expect(normalizeHelp(MEMORY_CLEAR_1050)).not.toContain('\n');
    expect(helpHash(MEMORY_CLEAR_1050.replace('whole global', 'global'))).not.toBe(helpHash(MEMORY_CLEAR_1050));
  });
  it('keeps one space where words were apart, so joining two words is a change', () => {
    expect(normalizeHelp('  --global \r\n\t  Clear  ')).toBe('--global Clear');
    expect(helpHash('--max-turns <N>')).not.toBe(helpHash('--max-turns<N>'));
  });
  it('drops the value of a variable the shell set, so the page hashes as with it unset', () => {
    const set = ENV_LINES
      .replace('[env: GROK_SANDBOX=]', '[env: GROK_SANDBOX=workspace]')
      .replace('[env: GROK_AGENT_SECRET=]', '[env: GROK_AGENT_SECRET=synthetic-secret-1234]')
      .replace('[env: CURSOR_WORKER_NAME=]', '[env: CURSOR_WORKER_NAME=my worker]');
    expect(set).toContain('synthetic-secret-1234');
    expect(normalizeHelp(set)).not.toContain('synthetic-secret-1234');
    expect(normalizeHelp(set)).toBe(normalizeHelp(ENV_LINES));
    expect(helpHash(set)).toBe(helpHash(ENV_LINES));
  });
  it('leaves the rest of the page alone, the hidden marker included, and a changed variable name is a change', () => {
    expect(normalizeHelp(ENV_LINES)).toContain('[env: GROK_SANDBOX=]');
    expect(normalizeHelp(ENV_LINES)).toContain('[env: CURSOR_API_KEY]');
    expect(normalizeHelp(ENV_LINES)).toContain('Secret token for client authentication (auto-generated if not provided)');
    expect(normalizeHelp(ENV_LINES)).toContain('(`GROK_AGENT_HOST_BACKEND=1`)');
    expect(helpHash(ENV_LINES.replace('GROK_SANDBOX', 'GROK_SANDBOX_PROFILE'))).not.toBe(helpHash(ENV_LINES));
  });
  it('reads a page whose value holds "]" as changed — never a changed page as unchanged', () => {
    const odd = ENV_LINES.replace('[env: GROK_AGENT_SECRET=]', '[env: GROK_AGENT_SECRET=a]b]');
    expect(helpHash(odd)).not.toBe(helpHash(ENV_LINES));
  });
});

describe('helpReadEnv', () => {
  const shell = {
    Path: 'C:\\grok\\bin;C:\\Windows', PATHEXT: '.COM;.EXE', SystemRoot: 'C:\\Windows', windir: 'C:\\Windows',
    TEMP: 'C:\\t', TMP: 'C:\\t', NoDefaultCurrentDirectoryInExePath: '1',
    HOME: 'C:\\Users\\me', USERPROFILE: 'C:\\Users\\me', APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', GROK_HOME: 'C:\\Users\\me\\.grok',
    GROK_SANDBOX: 'workspace', GROK_AGENT_SECRET: 's', XAI_API_KEY: 'k', CURSOR_API_KEY: 'k', CURSOR_WORKER_NAME: 'w',
    CLICOLOR_FORCE: '1', COLUMNS: '200', TERM: 'xterm',
  };
  it('keeps only what grok needs to start, and puts every home in the throwaway one', () => {
    const env = helpReadEnv(shell, 'D:\\throwaway', 'win32');
    expect(env).toEqual({
      Path: shell.Path, PATHEXT: shell.PATHEXT, SystemRoot: shell.SystemRoot, windir: shell.windir,
      TEMP: shell.TEMP, TMP: shell.TMP, NoDefaultCurrentDirectoryInExePath: '1',
      HOME: 'D:\\throwaway', USERPROFILE: 'D:\\throwaway', GROK_HOME: 'D:\\throwaway',
      APPDATA: 'D:\\throwaway\\AppData\\Roaming', LOCALAPPDATA: 'D:\\throwaway\\AppData\\Local',
    });
  });
  it('outside win32 keeps PATH and TMPDIR, and points HOME, USERPROFILE and GROK_HOME at the throwaway one (no AppData)', () => {
    const env = helpReadEnv({ PATH: '/usr/bin', TMPDIR: '/tmp', HOME: '/home/me', LANG: 'C.UTF-8', GROK_SANDBOX: 'x' }, '/tmp/h', 'linux');
    expect(env).toEqual({ PATH: '/usr/bin', TMPDIR: '/tmp', HOME: '/tmp/h', USERPROFILE: '/tmp/h', GROK_HOME: '/tmp/h' });
  });
});

describe('helpPages', () => {
  it('names the top level, each subcommand and each nested one, skipping clap\'s own help', () => {
    expect(helpPages(['help', 'memory', 'models'], { memory: ['clear', 'help'] }))
      .toEqual([[], ['memory'], ['memory', 'clear'], ['models']]);
  });
  it('gives the same order whatever order the names come in', () => {
    expect(helpPages(['models', 'help', 'memory'], { memory: ['list', 'help', 'clear'] }))
      .toEqual([[], ['memory'], ['memory', 'clear'], ['memory', 'list'], ['models']]);
  });
  it('reads a snapshot without the nested map as no nested pages', () => {
    expect(helpPages(['models'], undefined)).toEqual([[], ['models']]);
    expect(helpPages(undefined, undefined)).toEqual([[]]);
  });
});

describe('byCodeUnit', () => {
  it('orders names the way .sort() with no compare function does', () => {
    const names = ['worktree rm', 'b', 'a', 'B', 'a-b', 'a b', '', 'a'];
    expect([...names].sort(byCodeUnit)).toEqual([...names].sort());
    expect(byCodeUnit('a', 'a')).toBe(0);
    expect(byCodeUnit('a', 'b')).toBe(-1);
    expect(byCodeUnit('b', 'a')).toBe(1);
  });
});

describe('hashPages', () => {
  const pages = [[], ['memory'], ['memory', 'clear'], ['models'], ['worktree'], ['worktree', 'rm']];
  it('hashes each page once — the ones already read from their text, every other one by reading it', () => {
    const reads: string[] = [];
    const { helpHashes, helpUnreadable } = hashPages(pages, { '': 'top page', memory: 'memory page', models: 'models page', worktree: 'worktree page' }, [],
      (path: string[]) => { reads.push(path.join(' ')); return `${path.join(' ')} page`; });
    expect(reads).toEqual(['memory clear', 'worktree rm']);
    expect(helpUnreadable).toEqual([]);
    expect(helpHashes).toEqual({
      '': helpHash('top page'), memory: helpHash('memory page'), 'memory clear': helpHash('memory clear page'),
      models: helpHash('models page'), worktree: helpHash('worktree page'), 'worktree rm': helpHash('worktree rm page'),
    });
  });
  it('names a page it cannot read, and does not read again a page whose read already failed', () => {
    const reads: string[] = [];
    const { helpHashes, helpUnreadable } = hashPages([[], ['memory'], ['models'], ['worktree'], ['worktree', 'rm']],
      { '': 'top page', models: 'models page', worktree: 'worktree page' }, ['memory'],
      (path: string[]) => { reads.push(path.join(' ')); throw new Error('exit 1'); });
    expect(reads).toEqual(['worktree rm']);
    expect(helpUnreadable).toEqual(['memory', 'worktree rm']);
    expect(Object.keys(helpHashes)).toEqual(['', 'models', 'worktree']);
  });
  it('takes only the pages it was given as read, not what an object inherits', () => {
    const { helpHashes, helpUnreadable } = hashPages([[], ['constructor']], { '': 'top page' }, ['constructor'],
      () => { throw new Error('not read again'); });
    expect(helpUnreadable).toEqual(['constructor']);
    expect(Object.keys(helpHashes)).toEqual(['']);
  });
});

describe('helpBodyDiff', () => {
  const was = { '': 'a', memory: 'b', 'memory clear': helpHash(MEMORY_CLEAR_1044), models: 'c' };
  const now = { '': 'a', memory: 'b', 'memory clear': helpHash(MEMORY_CLEAR_1050), models: 'c' };
  it('names the pages whose body changed', () => {
    expect(helpBodyDiff(was, now)).toEqual(['memory clear']);
  });
  it('reports nothing when every body matches', () => {
    expect(helpBodyDiff(now, { ...now })).toEqual([]);
  });
  it('says "not compared" (null), not "unchanged", when the snapshot has no hashes', () => {
    expect(helpBodyDiff(undefined, now)).toBeNull();
    expect(helpBodyDiff(null, now)).toBeNull();
    for (const notAMap of ['4f07683f081158ea', [], ['memory clear']]) expect(helpBodyDiff(notAMap, now)).toBeNull();
  });
  it('names changed pages in sorted order, whatever order they were read in', () => {
    const wasTwo = { worktree: 'a', clone: 'b' };
    expect(helpBodyDiff(wasTwo, { worktree: 'x', clone: 'y' })).toEqual(['clone', 'worktree']);
  });
  it('compares only pages hashed on both sides, so a page unread on either side is not a change', () => {
    const { 'memory clear': _unreadThen, ...wasWithout } = was;
    const { 'memory clear': _unreadNow, ...nowWithout } = now;
    expect(helpBodyDiff(wasWithout, now)).toEqual([]);
    expect(helpBodyDiff(was, nowWithout)).toEqual([]);
  });
  it('leaves added and removed pages to the name comparison', () => {
    const { models: _gone, ...without } = now;
    expect(helpBodyDiff(was, { ...without, 'worktree create': 'd' })).toEqual(['memory clear']);
  });
});

describe('helpBodyReport', () => {
  const hashes = { '': 'a', memory: 'b', 'memory clear': 'c', worktree: 'd', 'worktree rm': 'e' };
  const read = (helpHashes: Record<string, string>, helpUnreadable: string[] = []) => ({ acceptsRequiredFlag: true, helpHashes, helpUnreadable });
  const all = (r: { note: string[] }) => r.note.join('\n');

  it('reports nothing for an unchanged binary', () => {
    expect(helpBodyReport({ helpHashes: hashes, helpUnreadable: [] }, read({ ...hashes }))).toEqual({
      changed: [], notCompared: { now: [], snapshot: [] }, anyNotCompared: false, drifts: false, note: [], guidance: [],
    });
  });
  it('names the changed pages, the top level as such, counts them as drift and points at step 1b', () => {
    const r = helpBodyReport({ helpHashes: hashes }, read({ ...hashes, '': 'A', 'memory clear': 'C' }));
    expect(r.changed).toEqual(['', 'memory clear']);
    expect(r.drifts).toBe(true);
    expect(r.note).toEqual([]);
    expect(r.guidance).toEqual([
      '  1b. THE TEXT OF THESE HELP PAGES CHANGED: (top level), memory clear.',
      '     No name has to move for this — 1.0.50 changed `memory clear` and `worktree rm` this way, and both',
      '     were behaviour (A64, A65) — and a changed global option shows on every page. Read what each page',
      '     now says against what this plugin relies on.',
    ]);
  });
  const NO_HASHES = [
    'NOTE — the snapshot has no help-page hashes, so page bodies were not compared ("not compared",',
    '       not "unchanged"). Accept a baseline with --update once the contract is re-measured.',
  ];
  it('compares nothing, says so, and is no drift when the snapshot has no hashes', () => {
    const r = helpBodyReport({}, read({ ...hashes }));
    expect(r.changed).toBeNull();
    expect(r.drifts).toBe(false);
    expect(r.notCompared).toEqual({ now: [], snapshot: null });
    expect(r.note).toEqual(NO_HASHES);
    expect(r.guidance).toEqual([]);
  });
  it('also names, against a snapshot without hashes, the pages this run could not read', () => {
    const r = helpBodyReport({}, read({ '': 'a' }, ['worktree', 'memory']));
    expect(r.note).toEqual([
      ...NO_HASHES,
      '       The --help of memory, worktree could not be read in this run, so an --update',
      '       now would record them as unreadable. Find out why first.',
    ]);
    expect(all(r)).not.toContain('Nor were');
  });
  it('compares nothing and prints nothing about bodies when grok rejected --no-auto-update', () => {
    expect(helpBodyReport({ helpHashes: hashes }, { acceptsRequiredFlag: false })).toEqual({
      changed: null, notCompared: null, anyNotCompared: false, drifts: false, note: [], guidance: [],
    });
  });
  it('names a page this run could not read, and the pages under an unread parent', () => {
    const { memory: _m, 'memory clear': _mc, 'worktree rm': _wr, ...readNow } = hashes;
    const r = helpBodyReport({ helpHashes: hashes, helpUnreadable: [] }, read(readNow, ['worktree rm', 'memory']));
    expect(r.changed).toEqual([]);
    expect(r.drifts).toBe(false);
    expect(r.anyNotCompared).toBe(true);
    expect(r.notCompared).toEqual({ now: ['memory', 'worktree rm'], snapshot: [] });
    expect(r.note).toEqual([
      'NOTE — some help-page bodies were not compared ("not compared", not "unchanged"):',
      '       now: the --help of memory, worktree rm could not be read in this run.',
      "       Nor were the pages under memory: nested pages are found from their parent's page.",
    ]);
  });
  it('names a page the snapshot could not read, on its own side', () => {
    const { 'worktree rm': _wr, ...snap } = hashes;
    const r = helpBodyReport({ helpHashes: snap, helpUnreadable: ['worktree rm'] }, read({ ...hashes }));
    expect(r.notCompared).toEqual({ now: [], snapshot: ['worktree rm'] });
    expect(r.note).toEqual([
      'NOTE — some help-page bodies were not compared ("not compared", not "unchanged"):',
      '       snapshot: the --help of worktree rm could not be read when the snapshot was taken.',
    ]);
    const parent = helpBodyReport({ helpHashes: { '': 'a' }, helpUnreadable: ['memory'] }, read({ '': 'a' }));
    expect(parent.note.at(-1)).toBe("       Nor were the pages under memory: nested pages are found from their parent's page.");
  });
});

// The probe does its work at import time, so its wiring of the module can only be held by its text (as
// probe-unauth.test.ts does for its probe).
describe('probe:contract wires the module in', () => {
  // LF whatever the checkout: a win32 clone has CRLF.
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../scripts/probe-contract-drift.mjs'), 'utf8').replace(/\r\n/g, '\n');
  it('counts a changed page as drift, so --strict fails on it', () => {
    expect(src).toContain('  || helpBodies.drifts\n');
  });
  it('reads through grok() in the bare environment unless a call says otherwise', () => {
    expect(src).toContain('const READ_ENV = helpReadEnv(process.env, READ_HOME);');
    expect(src).toContain('function grok(args, env = READ_ENV) {');
  });
  it('reads only --version and models through grok() in another environment — every other call takes the default', () => {
    expect(src.match(/grok\(\[[^\]]*\],[^)]*\)/g)).toEqual(["grok(['--version'], process.env)", "grok(['models'], process.env)"]);
  });
  it('starts grok in two places only: grok() and the --no-auto-update check', () => {
    expect(src.match(/execFileSync\(/g)).toHaveLength(2);
  });
  it('removes the read home once the reads are done, and on exit', () => {
    expect(src).toContain('process.on(\'exit\', removeReadHome);');
    expect(src).toContain('  removeReadHome(); // the last read in READ_ENV is done\n');
  });
  // The text of one top-level function (up to its closing brace at column 0), and where a snippet sits.
  const fnText = (head: string) => {
    const start = src.indexOf(head);
    expect(start, head).toBeGreaterThan(-1);
    return src.slice(start, src.indexOf('\n}\n', start) + 2);
  };
  const at = (snippet: string) => {
    const i = src.indexOf(snippet);
    expect(i, snippet).toBeGreaterThan(-1);
    return i;
  };
  // These pin whole spans, not a token: a test of one token let rewrites with the same effect through (a later
  // duplicate `env:` key, the check rewritten through grok() — found by review). A harmless edit of these lines has
  // to update the test too; that is the price of holding a script that runs at import time.
  it('passes the chosen environment to every grok() read — the bare one unless the call names another', () => {
    expect(fnText('function grok(args, env = READ_ENV) {')).toBe([
      'function grok(args, env = READ_ENV) {',
      '  // `--no-auto-update` on every call: this probe must describe the binary that is installed, not',
      '  // trigger the self-update it exists to detect.',
      "  return execFileSync('grok', [REQUIRED_UNDOCUMENTED_FLAG, ...args], {",
      '    env,',
      "    encoding: 'utf8',",
      '    timeout: 60_000,',
      '    maxBuffer: 8 * 1024 * 1024,',
      '  });',
      '}',
    ].join('\n'));
  });
  it('runs the --no-auto-update check as the maintainer runs grok, not through grok() and its bare environment', () => {
    const check = fnText('function acceptsRequiredFlag() {');
    expect(check).toContain("execFileSync('grok', [REQUIRED_UNDOCUMENTED_FLAG, '--version'], {\n      encoding: 'utf8',\n      timeout: 60_000,\n      maxBuffer: 1024 * 1024,\n      stdio: ['ignore', 'pipe', 'pipe'],\n    });");
    expect(check).not.toMatch(/\bgrok\(|process\.env/);
  });
  it('reads in a fresh throwaway folder (with the win32 AppData folders) and removes exactly that folder', () => {
    expect(src).toContain("\nconst READ_HOME = mkdtempSync(join(tmpdir(), 'grok-probe-help-'));\n");
    expect(src).toContain("\nif (process.platform === 'win32') for (const d of ['Roaming', 'Local']) mkdirSync(join(READ_HOME, 'AppData', d), { recursive: true });\n");
    expect(src).toContain("\nconst removeReadHome = () => {\n  try { rmSync(READ_HOME, { recursive: true, force: true }); } catch { /* best effort — a temp folder */ }\n};\n");
  });
  it('removes the read home in one place: right after the completions read, before models', () => {
    expect(src.match(/removeReadHome\(\)/g)).toHaveLength(1);
    expect(src).toContain("    completionsNote = `completions unavailable: ${String(err && err.message).split('\\n')[0]}`;\n  }\n  removeReadHome(); // the last read in READ_ENV is done\n");
    const removal = at('  removeReadHome(); // the last read in READ_ENV is done\n');
    expect(at('hashPages(helpPages(subcommands, nested), pageText, nestedUnreadable,')).toBeLessThan(removal);
    expect(at("parseCompletionSubcommands(grok(['completions', 'bash']))")).toBeLessThan(removal);
    expect(removal).toBeLessThan(at("parseModels(grok(['models'], process.env))"));
  });
  it('hashes every page once, from the pages already read, without reading a failed parent again', () => {
    expect(src).toContain('  const pageText = { \'\': help };\n');
    expect(src).toContain('      pageText[sub] = subHelp;\n');
    expect(src).toContain('hashPages(helpPages(subcommands, nested), pageText, nestedUnreadable,\n    (path) => grok([...path, \'--help\']));');
  });
  it('keeps the hashes in the snapshot, and warns when --update could not read a page', () => {
    expect(src).toContain('    helpHashes,\n    helpUnreadable,\n');
    expect(src).toContain('  if (now.helpUnreadable?.length) {\n    console.error(`WARNING — could not read the --help of: ${now.helpUnreadable.join(\', \')}. Their page bodies are`);');
  });
  it('reports what the module computed — the JSON fields, the NOTE and step 1b', () => {
    expect(src).toContain('const helpBodies = helpBodyReport(was, now);');
    expect(src).toContain('  helpBodiesChanged: helpBodies.changed,\n  ...(helpBodies.anyNotCompared ? { helpBodiesNotCompared: helpBodies.notCompared } : {}),\n');
    expect(src).toContain('if (helpBodies.note.length) {\n  console.error(\'\');\n  for (const line of helpBodies.note) console.error(line);\n}');
    expect(src).toContain('  for (const line of helpBodies.guidance) console.error(line);\n');
  });
});

describe('the committed snapshot', () => {
  const snapshot = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../scripts/contract-snapshot.json'), 'utf8'));
  it('holds a body hash for every page its name lists give, or names the page as unreadable', () => {
    const expected = helpPages(snapshot.subcommands, snapshot.nested).map((p: string[]) => p.join(' ')).sort(byCodeUnit);
    const recorded = [...Object.keys(snapshot.helpHashes ?? {}), ...(snapshot.helpUnreadable ?? [])].sort(byCodeUnit);
    expect(recorded).toEqual(expected);
    for (const h of Object.values(snapshot.helpHashes ?? {})) expect(h).toMatch(/^[0-9a-f]{16}$/);
  });
});
