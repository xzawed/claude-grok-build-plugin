import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { join, delimiter, resolve } from 'node:path';
import {
  buildGrokEnv, grokBinDir, grokHome, grokHomeDependsOnFolder, grokHomeFor, grokHomeNote, insideGrokWorker,
  prependGrokBin,
} from '../src/env.js';

const withKeys = { PATH: '/usr/bin', XAI_API_KEY: 'sk-x', GROK_CODE_XAI_API_KEY: 'sk-y' };
const defaultBin = join(homedir(), '.grok', 'bin');
const defaultHome = join(homedir(), '.grok');

describe('grokHome', () => {
  it('defaults to ~/.grok', () => {
    expect(grokHome({})).toBe(defaultHome);
  });
  it('respects a non-empty GROK_HOME override', () => {
    expect(grokHome({ GROK_HOME: '/opt/grokhome' })).toBe('/opt/grokhome');
  });
  it('falls back to the default for an empty GROK_HOME', () => {
    expect(grokHome({ GROK_HOME: '' })).toBe(defaultHome);
  });
});

// A35 (docs/10; MEASURED 2026-09-24, grok 1.0.41 on win32, `grok du --json`): grok resolves a
// RELATIVE GROK_HOME against the directory it runs in, and does not expand `~` — `~/.x` is just a
// relative path. The plugin resolved it against its own process directory instead. Reproduced on
// the shipped v0.2.33 bundle: with the session in <task>/rel-home, a delegation into <task> was
// refused in 129 ms as "not logged in", the hook denied it too, and grok never started.
// A drive-and-root (or UNC) path on Windows, a rooted path elsewhere: absolute on this platform.
// A bare '/opt/grokhome' would not do — on Windows it has no drive, which is its own case (below).
const ABS_HOME = resolve('/opt/grokhome');

describe('grokHomeDependsOnFolder — which GROK_HOME values grok resolves per folder (A35)', () => {
  it('on POSIX, exactly the relative ones', () => {
    for (const p of ['rel-home', '~/.grok-work', './x']) expect(grokHomeDependsOnFolder(p, 'linux'), p).toBe(true);
    expect(grokHomeDependsOnFolder('/opt/grokhome', 'linux')).toBe(false);
  });
  // MEASURED 2026-09-24 (grok 1.0.41, `grok du --json`): a rooted path with no drive lands on the
  // drive of grok's working folder — started on C: gave C:\<p>\gh, on D: gave D:\<p>\gh, and
  // `--cwd <D: folder>` from C: gave D:\<p>\gh. Node's isAbsolute calls it absolute, which put the
  // plugin's lookup on whatever drive the ASKING process was on (adversarial review, reproduced).
  it('on Windows, also a rooted path with no drive, and a drive with no root', () => {
    for (const p of ['rel-home', '~/.grok-work', '\\p\\gh', '/p/gh', 'C:rel']) {
      expect(grokHomeDependsOnFolder(p, 'win32'), p).toBe(true);
    }
    for (const p of ['C:\\grok', 'c:/grok', '\\\\srv\\share\\grok', '//srv/share/grok', '\\\\?\\C:\\grok']) {
      expect(grokHomeDependsOnFolder(p, 'win32'), p).toBe(false);
    }
    // FOUND BY THE RE-REVIEW of the first version, which asked win32.parse() for a root ending in a
    // separator: a share root with no trailing one (and a bare device path) failed that test, so a
    // grok_cli prompt run that main denied was let through, with a note calling the path relative.
    for (const p of ['\\\\srv\\share', '//srv/share', '\\\\?\\C:', '\\\\srv']) {
      expect(grokHomeDependsOnFolder(p, 'win32'), p).toBe(false);
    }
  });
});

describe('grokHomeFor — grok home as grok resolves it from the folder it runs in (A35)', () => {
  const task = join(homedir(), 'a35-task-folder');
  it('keeps an absolute GROK_HOME as it is', () => {
    expect(grokHomeFor({ GROK_HOME: ABS_HOME }, task)).toBe(ABS_HOME);
  });
  it('puts a Windows rooted path with no drive on the drive of the folder grok runs in', () => {
    expect(grokHomeFor({ GROK_HOME: '\\p\\gh' }, 'D:\\task', 'win32')).toBe('D:\\p\\gh');
    expect(grokHomeFor({ GROK_HOME: '\\p\\gh' }, 'C:\\task', 'win32')).toBe('C:\\p\\gh');
    expect(grokHomeFor({ GROK_HOME: 'C:\\grok' }, 'D:\\task', 'win32')).toBe('C:\\grok');
  });
  it('resolves a relative GROK_HOME against the folder grok runs in', () => {
    expect(grokHomeFor({ GROK_HOME: 'rel-home' }, task)).toBe(join(task, 'rel-home'));
  });
  it('does not expand ~, because grok does not (measured)', () => {
    expect(grokHomeFor({ GROK_HOME: '~/.grok-work' }, task)).toBe(join(task, '~', '.grok-work'));
  });
  it('is the default home when GROK_HOME is unset or empty, whatever the folder', () => {
    expect(grokHomeFor({}, task)).toBe(defaultHome);
    expect(grokHomeFor({ GROK_HOME: '' }, task)).toBe(defaultHome);
  });
});

// A36 (docs/10; MEASURED 2026-09-25, grok 1.0.41 on win32 — oracles `grok models` and a delegate-shaped
// headless run on a synthetic session, quota 0; row ids are the hand-picked harness's). grok opens
// <GROK_HOME>\auth.json through Windows path normalization; Node turns every fs path into \\?\ form,
// which skips it. v0.2.34 disagreed on 24 of 81 hand-picked spellings (456 of 714 generated runs — CHANGELOG
// v0.2.35). Two rules explained every one:
//   R1  a segment followed by another one loses a trailing dot when it ends in exactly ONE
//       (h. -> h, "h ." -> "h "; h.. and h... stay — rows with literal folders h. and h.. showed it)
//   R2  the folder grok works in loses the trailing spaces and dots of its last segment, unless it ends
//       in a separator ("w \" is refused by grok: it cannot enter "w ")
// A trailing SPACE on GROK_HOME is NOT a disagreement: grok opens "<home> \auth.json", keeps the space,
// and says "Not signed in" too (A02/A03). `grok du` does report the trimmed folder — that report is
// what the A36 entry was built on, and it is not where grok looks for its session.
describe('grokHome / grokHomeFor on Windows — the home as Windows opens it for grok (A36)', () => {
  it('drops one trailing dot from a segment that ends in exactly one (R1)', () => {
    expect(grokHome({ GROK_HOME: 'C:\\d\\h.' }, 'win32')).toBe('C:\\d\\h');             // A04
    expect(grokHome({ GROK_HOME: 'C:/d/h.' }, 'win32')).toBe('C:\\d\\h');               // G1
    expect(grokHome({ GROK_HOME: 'C:\\d\\mid.\\h' }, 'win32')).toBe('C:\\d\\mid\\h');   // A22
    expect(grokHome({ GROK_HOME: 'C:\\d\\h.\\' }, 'win32')).toBe('C:\\d\\h\\');         // G2
    expect(grokHome({ GROK_HOME: 'C:\\d\\h.\\.' }, 'win32')).toBe('C:\\d\\h');          // G3
    expect(grokHome({ GROK_HOME: 'C:\\d\\h .' }, 'win32')).toBe('C:\\d\\h ');           // L6
    expect(grokHomeFor({ GROK_HOME: 'C:\\d\\h.' }, 'C:\\task', 'win32')).toBe('C:\\d\\h');
  });
  it('keeps two or more trailing dots, and trailing spaces, as grok does', () => {
    for (const p of ['C:\\d\\h..', 'C:\\d\\h...', 'C:\\d\\mid..\\h', 'C:\\d\\h ', 'C:\\d\\h   ', 'C:\\d\\h. ', 'C:\\d\\mid \\h']) {
      expect(grokHome({ GROK_HOME: p }, 'win32'), p).toBe(p);                            // L1 L9 L7 A02 A03 L5 A21
    }
  });
  it('leaves a \\\\?\\ path alone — Windows does not normalize it, for grok or for Node', () => {
    expect(grokHome({ GROK_HOME: '\\\\?\\C:\\d\\h.' }, 'win32')).toBe('\\\\?\\C:\\d\\h.'); // A33
  });
  it('resolves a relative home against the folder as grok enters it (R2, then R1)', () => {
    for (const f of ['C:\\d\\w ', 'C:\\d\\w.', 'C:\\d\\w..', 'C:\\d\\w. ', 'C:\\d\\w...', 'C:\\d\\w .', 'C:\\d\\w.. ']) {
      expect(grokHomeFor({ GROK_HOME: 'h' }, f, 'win32'), f).toBe('C:\\d\\w\\h');        // B04-B07 G6-G8
    }
    expect(grokHomeFor({ GROK_HOME: 'h' }, 'C:\\d\\a.\\w', 'win32')).toBe('C:\\d\\a\\w\\h'); // B17
    expect(grokHomeFor({ GROK_HOME: 'h' }, 'C:\\d\\w \\', 'win32')).toBe('C:\\d\\w \\h');   // B08
    expect(grokHomeFor({ GROK_HOME: 'h.' }, 'C:\\d\\w', 'win32')).toBe('C:\\d\\w\\h');      // B03
    expect(grokHomeFor({ GROK_HOME: 'mid.\\h' }, 'C:\\d\\w', 'win32')).toBe('C:\\d\\w\\mid\\h'); // G4
    expect(grokHomeFor({ GROK_HOME: '.\\h.' }, 'C:\\d\\w', 'win32')).toBe('C:\\d\\w\\h');   // G5
    expect(grokHomeFor({ GROK_HOME: 'h ' }, 'C:\\d\\w', 'win32')).toBe('C:\\d\\w\\h ');     // B02
    expect(grokHomeFor({ GROK_HOME: '..\\w\\h' }, 'C:\\d\\w.', 'win32')).toBe('C:\\d\\w\\h'); // B19
    expect(grokHomeFor({ GROK_HOME: '\\p.\\gh' }, 'D:\\task', 'win32')).toBe('D:\\p\\gh');
  });
  // The trim runs before every gated call on a caller-supplied folder. /[ .]+$/ took 901 ms on 40 000
  // spaces not ending the string and grew 4x per doubling (measured, V8) — 200 000 would be ~20 s.
  it('trims a folder in linear time: a long run of spaces inside it cannot stall the check', () => {
    const folder = `C:\\d\\w${' '.repeat(200_000)}x`;
    expect(grokHomeFor({ GROK_HOME: 'h' }, folder, 'win32')).toBe(`${folder}\\h`);
  });
  it('changes nothing on POSIX, where no such normalization exists', () => {
    expect(grokHome({ GROK_HOME: '/x/h.' }, 'linux')).toBe('/x/h.');
    expect(grokHome({ GROK_HOME: '/x/h ' }, 'linux')).toBe('/x/h ');
    expect(grokHomeFor({ GROK_HOME: 'h' }, '/w.', 'linux')).toBe('/w./h');
    expect(grokHomeFor({ GROK_HOME: 'h.' }, '/w', 'linux')).toBe('/w/h.');
  });
});

describe('grokHomeNote — say so when the answer depends on the folder (A35)', () => {
  const task = join(homedir(), 'a35-task-folder');
  it('says nothing when GROK_HOME is absolute or unset', () => {
    expect(grokHomeNote({}, task)).toBeUndefined();
    expect(grokHomeNote({ GROK_HOME: ABS_HOME }, task)).toBeUndefined();
  });
  it('speaks up for a Windows rooted path with no drive, which moves with the folder too', () => {
    expect(grokHomeNote({ GROK_HOME: '\\p\\gh' }, 'D:\\task', 'win32') ?? '').toContain('D:\\p\\gh');
  });
  it('names the value and the folder it was resolved against when GROK_HOME is relative', () => {
    const note = grokHomeNote({ GROK_HOME: '~/.grok-work' }, task) ?? '';
    expect(note).toContain('~/.grok-work');
    expect(note).toContain(join(task, '~', '.grok-work'));
  });
});

// A36: `set GROK_HOME=C:\x && claude` in cmd puts the space before && into the value. grok then looks
// under "C:\x \auth.json" and is not signed in (measured, A02) — so "not logged in" is the right answer,
// but "run grok login" alone is not the fix: the value is. Whitespace grok cannot use at all (tab, CR,
// LF, a leading space) made `grok du`, `models` and `inspect` exit 1 with os error 123 (A15-A20).
describe('grokHomeNote — say so when GROK_HOME has whitespace at either end (A36)', () => {
  const TAB = String.fromCharCode(9);
  const CR = String.fromCharCode(13);
  it('speaks up for a trailing space, and gives the cmd cause on Windows', () => {
    const note = grokHomeNote({ GROK_HOME: 'C:\\d\\h ' }, 'C:\\task', 'win32') ?? '';
    expect(note).toContain('GROK_HOME');
    expect(note).toContain('C:\\d\\h ');
    expect(note).toContain('&&');
  });
  it('speaks up for a leading space, a tab and a carriage return too', () => {
    for (const p of [' C:\\d\\h', 'C:\\d\\h' + TAB, 'C:\\d\\h' + CR]) {
      expect(grokHomeNote({ GROK_HOME: p }, 'C:\\task', 'win32'), JSON.stringify(p)).toBeDefined();
    }
  });
  it('speaks up even when no folder is known — the hook asks that way', () => {
    expect(grokHomeNote({ GROK_HOME: 'C:\\d\\h ' }, undefined, 'win32')).toBeDefined();
    expect(grokHomeNote({ GROK_HOME: 'rel-home' }, undefined, 'win32')).toBeUndefined();
  });
  it('leaves out the cmd cause where there is no cmd', () => {
    const note = grokHomeNote({ GROK_HOME: '/x/h ' }, '/task', 'linux') ?? '';
    expect(note).toContain('GROK_HOME');
    expect(note).not.toContain('&&');
  });
  it('says both things when a relative value also has a trailing space', () => {
    const note = grokHomeNote({ GROK_HOME: 'h ' }, 'C:\\d\\w', 'win32') ?? '';
    expect(note).toContain('&&');
    expect(note).toContain('C:\\d\\w\\h ');
  });
  it('stays silent for a clean value', () => {
    expect(grokHomeNote({ GROK_HOME: 'C:\\d\\h' }, 'C:\\task', 'win32')).toBeUndefined();
    expect(grokHomeNote({ GROK_HOME: 'C:\\d\\h.' }, 'C:\\task', 'win32')).toBeUndefined();
  });
  // `set GROK_HOME= && claude` — an attempt to unset it in cmd — leaves one space. grok is not signed in
  // with it either (measured, B11); the advice is to remove the variable, not to set it to ''.
  it('says to remove a value that is nothing but whitespace, and names no home for it', () => {
    const note = grokHomeNote({ GROK_HOME: ' ' }, 'C:\\task', 'win32') ?? '';
    expect(note).toContain('지우세요');
    expect(note).not.toContain("''");
    expect(note).not.toContain('상대 경로');
  });
  it('does not call an absolute path relative just because whitespace leads it', () => {
    const note = grokHomeNote({ GROK_HOME: ' C:\\d\\h' }, 'C:\\task', 'win32') ?? '';
    expect(note).toContain("'C:\\d\\h'");
    expect(note).not.toContain('상대 경로');
  });
});

describe('grokBinDir', () => {
  it('defaults to ~/.grok/bin', () => {
    expect(grokBinDir({})).toBe(defaultBin);
  });
  it('respects a non-empty GROK_BIN_DIR override', () => {
    expect(grokBinDir({ GROK_BIN_DIR: '/opt/grok/bin' })).toBe('/opt/grok/bin');
  });
  it('falls back to the default for an empty GROK_BIN_DIR', () => {
    expect(grokBinDir({ GROK_BIN_DIR: '' })).toBe(defaultBin);
  });
});

describe('prependGrokBin', () => {
  it('prepends the grok bin dir to an existing PATH', () => {
    const out = prependGrokBin({ PATH: '/usr/bin' });
    expect(out.PATH).toBe(`${defaultBin}${delimiter}/usr/bin`);
  });
  it('is idempotent when the dir is already on PATH', () => {
    const out = prependGrokBin({ PATH: `${defaultBin}${delimiter}/usr/bin` });
    expect(out.PATH).toBe(`${defaultBin}${delimiter}/usr/bin`);
  });
  it('uses GROK_BIN_DIR when set', () => {
    const out = prependGrokBin({ PATH: '/usr/bin', GROK_BIN_DIR: '/opt/grok/bin' });
    expect(out.PATH).toBe(`/opt/grok/bin${delimiter}/usr/bin`);
  });
  it('handles an undefined PATH (yields just the grok dir)', () => {
    expect(prependGrokBin({}).PATH).toBe(defaultBin);
  });
  it('does not mutate the input env', () => {
    const input = { PATH: '/usr/bin' };
    prependGrokBin(input);
    expect(input.PATH).toBe('/usr/bin');
  });
  it('extends a Windows-spelled Path key in place, never adding a second PATH key', () => {
    const out = prependGrokBin({ Path: '/usr/bin', GROK_BIN_DIR: '/opt/grok/bin' });
    // Two keys differing only in case collapse to one in the child process, so the real
    // PATH would be dropped and grok would inherit only its own bin dir.
    expect(Object.keys(out).filter((k) => k.toLowerCase() === 'path')).toEqual(['Path']);
    expect(out.Path).toBe(`/opt/grok/bin${delimiter}/usr/bin`);
  });
  it('is idempotent for a Windows-spelled Path key', () => {
    const once = prependGrokBin({ Path: '/usr/bin', GROK_BIN_DIR: '/opt/grok/bin' });
    expect(prependGrokBin(once)).toEqual(once);
  });
  it('prefers an exact PATH key when an env somehow carries both spellings', () => {
    // Measured on win32: when two keys differ only in case the child keeps the uppercase
    // one, so prepending to `Path` here would hand grok an un-prepended PATH — worse than
    // touching neither. Only reachable for a hand-built env object, never for process.env.
    const out = prependGrokBin({ Path: '/from-Path', PATH: '/from-PATH', GROK_BIN_DIR: '/opt/grok/bin' });
    expect(out.PATH).toBe(`/opt/grok/bin${delimiter}/from-PATH`);
    expect(out.Path).toBe('/from-Path');
  });
});

describe('buildGrokEnv', () => {
  it('subscription mode strips both API-key vars even when present', () => {
    const out = buildGrokEnv('subscription', withKeys);
    expect(out.XAI_API_KEY).toBeUndefined();
    expect(out.GROK_CODE_XAI_API_KEY).toBeUndefined();
  });
  it('subscription mode strips API-key vars case-insensitively (Windows env casing)', () => {
    const mixed = {
      PATH: '/usr/bin',
      xai_api_key: 'sk-lower',
      Grok_Code_Xai_Api_Key: 'sk-mixed',
    };
    const out = buildGrokEnv('subscription', mixed);
    expect(out.xai_api_key).toBeUndefined();
    expect(out.Grok_Code_Xai_Api_Key).toBeUndefined();
    expect(out.XAI_API_KEY).toBeUndefined();
    expect(out.GROK_CODE_XAI_API_KEY).toBeUndefined();
  });
  it('subscription mode leaves unrelated secrets in env (billing-key policy only)', () => {
    const out = buildGrokEnv('subscription', {
      ...withKeys,
      AWS_SECRET_ACCESS_KEY: 'aws-secret',
      GITHUB_TOKEN: 'gh-secret',
    });
    expect(out.XAI_API_KEY).toBeUndefined();
    expect(out.AWS_SECRET_ACCESS_KEY).toBe('aws-secret');
    expect(out.GITHUB_TOKEN).toBe('gh-secret');
  });
  it('api mode passes the API-key vars through', () => {
    const out = buildGrokEnv('api', withKeys);
    expect(out.XAI_API_KEY).toBe('sk-x');
    expect(out.GROK_CODE_XAI_API_KEY).toBe('sk-y');
  });
  it('prepends the grok bin dir to PATH (both modes)', () => {
    expect(buildGrokEnv('subscription', withKeys).PATH).toBe(`${defaultBin}${delimiter}/usr/bin`);
    expect(buildGrokEnv('api', withKeys).PATH).toBe(`${defaultBin}${delimiter}/usr/bin`);
  });
  it('does not mutate the input env', () => {
    buildGrokEnv('subscription', withKeys);
    expect(withKeys.XAI_API_KEY).toBe('sk-x');
    expect(withKeys.PATH).toBe('/usr/bin');
  });
  it('fills HOME from homedir when neither HOME nor GROK_HOME is set', () => {
    const out = buildGrokEnv('subscription', { PATH: '/usr/bin' });
    expect(out.HOME).toBe(homedir());
  });
  it('leaves an explicit HOME or GROK_HOME alone', () => {
    expect(buildGrokEnv('subscription', { HOME: 'C:\\custom', PATH: '/usr/bin' }).HOME).toBe('C:\\custom');
    const withGrokHome = buildGrokEnv('subscription', { GROK_HOME: 'C:\\grokhome', PATH: '/usr/bin' });
    expect(withGrokHome.GROK_HOME).toBe('C:\\grokhome');
    expect(withGrokHome.HOME).toBeUndefined();
  });
  // A34: grok loads this very plugin into every worker it runs for us, and hands the worker's env
  // to the MCP servers it starts (measured 2026-09-24: a marker set on grok's parent reached a
  // grok-started stdio server). The marker is how that nested copy of this server learns where it
  // is — without it, it cannot refuse.
  it('marks every grok it starts as a grok-build worker (both modes)', () => {
    expect(buildGrokEnv('subscription', { PATH: '/usr/bin' }).GROK_BUILD_WORKER).toBe('1');
    expect(buildGrokEnv('api', { PATH: '/usr/bin' }).GROK_BUILD_WORKER).toBe('1');
  });
  it('does not put the worker marker on the input env', () => {
    const input: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    buildGrokEnv('subscription', input);
    expect(input.GROK_BUILD_WORKER).toBeUndefined();
  });
});

describe('insideGrokWorker (A34)', () => {
  it('is true only for the exact marker this module writes', () => {
    expect(insideGrokWorker({ GROK_BUILD_WORKER: '1' })).toBe(true);
    expect(insideGrokWorker({})).toBe(false);
    expect(insideGrokWorker({ GROK_BUILD_WORKER: '' })).toBe(false);
    expect(insideGrokWorker({ GROK_BUILD_WORKER: '0' })).toBe(false);
  });
  it('recognises what buildGrokEnv hands to grok — writer and reader are one contract', () => {
    expect(insideGrokWorker(buildGrokEnv('subscription', { PATH: '/usr/bin' }))).toBe(true);
  });
});
