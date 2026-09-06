import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatStartupFailure, resolveAuthMode } from '../src/config.js';

describe('resolveAuthMode', () => {
  it('defaults to subscription when unset', () => {
    expect(resolveAuthMode({})).toBe('subscription');
  });
  it('defaults to subscription when empty/whitespace', () => {
    expect(resolveAuthMode({ GROK_BUILD_AUTH_MODE: '  ' })).toBe('subscription');
  });
  it('accepts api (case-insensitive)', () => {
    expect(resolveAuthMode({ GROK_BUILD_AUTH_MODE: 'API' })).toBe('api');
  });
  it('accepts subscription', () => {
    expect(resolveAuthMode({ GROK_BUILD_AUTH_MODE: 'subscription' })).toBe('subscription');
  });
  it('throws on an invalid value', () => {
    expect(() => resolveAuthMode({ GROK_BUILD_AUTH_MODE: 'metered' })).toThrow(/GROK_BUILD_AUTH_MODE/);
  });
});

describe('startup failure report (A12)', () => {
  // MEASURED 2026-09-06, `GROK_BUILD_AUTH_MODE=nonsense node mcp-server/dist/index.js`:
  // exit 1 after 499ms, and six stack frames into dist/index.js:13327 around the one line that
  // actually says what to fix. All nine tools and every /grok:* command vanish together, and the
  // client only sees a connection failure — so the log is the operator's only lead.
  it('turns our own configuration error into one actionable line', () => {
    const line = formatStartupFailure(new Error('Invalid GROK_BUILD_AUTH_MODE: "nonsense". Expected "subscription" or "api".'));
    expect(line).toBe(
      'grok-build MCP server did not start: Invalid GROK_BUILD_AUTH_MODE: "nonsense". Expected "subscription" or "api".',
    );
    expect(line).not.toContain('    at ');
  });

  it('keeps the real error for anything else — there the stack IS the diagnosis', () => {
    expect(formatStartupFailure(new Error('EADDRINUSE'))).toBeUndefined();
    expect(formatStartupFailure(new TypeError('x is not a function'))).toBeUndefined();
    expect(formatStartupFailure('a thrown string')).toBeUndefined();
    expect(formatStartupFailure(undefined)).toBeUndefined();
  });

  // The message resolveAuthMode actually throws must keep matching the prefix the entrypoint
  // tests for — these two are wired together only by that string.
  it('matches what resolveAuthMode really throws', () => {
    let thrown: unknown;
    try {
      resolveAuthMode({ GROK_BUILD_AUTH_MODE: 'nonsense' });
    } catch (e) {
      thrown = e;
    }
    expect(formatStartupFailure(thrown)).toContain('Expected "subscription" or "api"');
  });
});

describe('startup failure e2e against the committed bundle (A12)', () => {
  it('prints one line, no stack, and exits 1', () => {
    const dist = join(dirname(fileURLToPath(import.meta.url)), '../dist/index.js');
    const r = spawnSync(process.execPath, [dist], {
      env: { ...process.env, GROK_BUILD_AUTH_MODE: 'nonsense' },
      encoding: 'utf8',
      input: '',
      timeout: 20_000,
      windowsHide: true,
    });
    expect(r.status).toBe(1);
    const err = (r.stderr ?? '').trim();
    expect(err).toContain('Expected "subscription" or "api"');
    expect(err).not.toContain('    at ');          // no stack frames
    expect(err.split('\n').length).toBe(1);        // exactly one line
  }, 30_000);

  it('a valid mode still starts and answers initialize', () => {
    const dist = join(dirname(fileURLToPath(import.meta.url)), '../dist/index.js');
    const init = JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } },
    });
    const r = spawnSync(process.execPath, [dist], {
      env: { ...process.env, GROK_BUILD_AUTH_MODE: 'subscription' },
      encoding: 'utf8',
      input: init + '\n',
      timeout: 20_000,
      windowsHide: true,
    });
    expect(r.stdout).toContain('"serverInfo"');
  }, 30_000);
});
