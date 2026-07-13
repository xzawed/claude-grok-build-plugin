import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { join, delimiter } from 'node:path';
import { buildGrokEnv, grokBinDir, prependGrokBin } from '../src/env.js';

const withKeys = { PATH: '/usr/bin', XAI_API_KEY: 'sk-x', GROK_CODE_XAI_API_KEY: 'sk-y' };
const defaultBin = join(homedir(), '.grok', 'bin');

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
});

describe('buildGrokEnv', () => {
  it('subscription mode strips both API-key vars even when present', () => {
    const out = buildGrokEnv('subscription', withKeys);
    expect(out.XAI_API_KEY).toBeUndefined();
    expect(out.GROK_CODE_XAI_API_KEY).toBeUndefined();
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
});
