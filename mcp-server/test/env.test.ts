import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { join, delimiter } from 'node:path';
import {
  buildGrokEnv, grokBinDir, grokHome, grokHomeFor, grokHomeNote, insideGrokWorker, prependGrokBin,
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
describe('grokHomeFor — grok home as grok resolves it from the folder it runs in (A35)', () => {
  const task = join(homedir(), 'a35-task-folder');
  it('keeps an absolute GROK_HOME as it is', () => {
    expect(grokHomeFor({ GROK_HOME: '/opt/grokhome' }, task)).toBe('/opt/grokhome');
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

describe('grokHomeNote — say so when the answer depends on the folder (A35)', () => {
  const task = join(homedir(), 'a35-task-folder');
  it('says nothing when GROK_HOME is absolute or unset', () => {
    expect(grokHomeNote({}, task)).toBeUndefined();
    expect(grokHomeNote({ GROK_HOME: '/opt/grokhome' }, task)).toBeUndefined();
  });
  it('names the value and the folder it was resolved against when GROK_HOME is relative', () => {
    const note = grokHomeNote({ GROK_HOME: '~/.grok-work' }, task) ?? '';
    expect(note).toContain('~/.grok-work');
    expect(note).toContain(join(task, '~', '.grok-work'));
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
