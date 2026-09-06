import type { AuthMode } from './types.js';

export function resolveAuthMode(env: NodeJS.ProcessEnv = process.env): AuthMode {
  const raw = env.GROK_BUILD_AUTH_MODE?.trim().toLowerCase();
  if (raw === undefined || raw === '') return 'subscription';
  if (raw === 'subscription' || raw === 'api') return raw;
  throw new Error(
    `Invalid GROK_BUILD_AUTH_MODE: "${env.GROK_BUILD_AUTH_MODE}". Expected "subscription" or "api".`,
  );
}

/** Marks the errors this module raises, so the entrypoint can tell them from a real crash. */
export const INVALID_MODE_PREFIX = 'Invalid GROK_BUILD_AUTH_MODE';

/**
 * A startup failure the operator can act on, as ONE line — or undefined when the failure is
 * not one of ours and its stack is the diagnosis.
 *
 * A12 (docs/10, MEASURED 2026-09-06 against the shipped bundle): GROK_BUILD_AUTH_MODE=nonsense
 * takes down all nine tools and every /grok:* command at once, and the client sees only a
 * generic connection failure. The one line that says what to fix was the first of six stack
 * frames pointing into dist/index.js, so anyone who opened the logs found a crash report about
 * a bundled line number instead of an instruction.
 *
 * Failing fast is correct and did NOT change — a silent default would run the wrong billing
 * mode, the one outcome this server must never produce. Only the report changed.
 */
export function formatStartupFailure(err: unknown): string | undefined {
  if (!(err instanceof Error) || !err.message.startsWith(INVALID_MODE_PREFIX)) return undefined;
  return 'grok-build MCP server did not start: ' + err.message;
}
