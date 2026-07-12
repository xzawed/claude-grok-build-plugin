import { describe, it, expect } from 'vitest';
import { resolveAuthMode } from '../src/config.js';

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
