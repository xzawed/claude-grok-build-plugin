import type { AuthMode } from './types.js';

export function resolveAuthMode(env: NodeJS.ProcessEnv = process.env): AuthMode {
  const raw = env.GROK_BUILD_AUTH_MODE?.trim().toLowerCase();
  if (raw === undefined || raw === '') return 'subscription';
  if (raw === 'subscription' || raw === 'api') return raw;
  throw new Error(
    `Invalid GROK_BUILD_AUTH_MODE: "${env.GROK_BUILD_AUTH_MODE}". Expected "subscription" or "api".`,
  );
}
