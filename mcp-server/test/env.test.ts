import { describe, it, expect } from 'vitest';
import { buildGrokEnv } from '../src/env.js';

const withKeys = { PATH: '/usr/bin', XAI_API_KEY: 'sk-x', GROK_CODE_XAI_API_KEY: 'sk-y' };

describe('buildGrokEnv', () => {
  it('subscription mode strips both API-key vars even when present', () => {
    const out = buildGrokEnv('subscription', withKeys);
    expect(out.XAI_API_KEY).toBeUndefined();
    expect(out.GROK_CODE_XAI_API_KEY).toBeUndefined();
    expect(out.PATH).toBe('/usr/bin');
  });
  it('api mode passes the API-key vars through', () => {
    const out = buildGrokEnv('api', withKeys);
    expect(out.XAI_API_KEY).toBe('sk-x');
    expect(out.GROK_CODE_XAI_API_KEY).toBe('sk-y');
  });
  it('does not mutate the input env', () => {
    buildGrokEnv('subscription', withKeys);
    expect(withKeys.XAI_API_KEY).toBe('sk-x');
  });
});
