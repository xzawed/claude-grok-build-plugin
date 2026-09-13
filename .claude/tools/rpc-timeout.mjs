/**
 * How long the audit harness waits for one JSON-RPC answer.
 *
 * Lives in its own module so `mcp-server/test/mcpcall-timeout.test.ts` can pin the rule without
 * importing `mcpcall.mjs` — importing that would spawn a server as a side effect.
 *
 * MEASURED 2026-09-13: `mcpcall.mjs` used a bare 240 s timer and never read the tool arguments,
 * so a delegation asking for `timeout_ms: 900000` was cut at exactly 240 s and reported
 * "TRANSPORT FAILURE: timeout on tools/call" — a message that cannot be told apart from a server
 * hang or a slow model. `docs/10` names this harness as THE way to reproduce defects against the
 * shipped bundle, so anything it cannot measure silently becomes "not reproducible".
 */

/** What a call with no opinion of its own gets. Unchanged from before the fix. */
export const DEFAULT_RPC_TIMEOUT_MS = 240_000;

/**
 * Added on top of the tool's own cap. The server turns ITS cap into a structured
 * `status: "timeout"` result, which tells the operator far more than a transport error, so the
 * harness must lose that race deliberately. The margin covers spawn, git work around the run,
 * and teardown.
 */
export const RPC_TIMEOUT_MARGIN_MS = 30_000;

/**
 * Timeout for one RPC.
 *
 * Only `tools/call` can carry a caller cap; `initialize` and `tools/list` keep the default.
 * Junk (0, negative, NaN, Infinity, non-numeric) is ignored rather than trusted, and the result
 * never drops below the default — a tool asking for 5 s must not leave the harness 5 s to spawn
 * a server, connect, and get an answer back.
 */
export function rpcTimeoutMs(method, args) {
  if (method !== 'tools/call') return DEFAULT_RPC_TIMEOUT_MS;
  const raw = args && typeof args === 'object' ? args.timeout_ms : undefined;
  const wanted = typeof raw === 'number' ? raw : Number.NaN;
  if (!Number.isFinite(wanted) || wanted <= 0) return DEFAULT_RPC_TIMEOUT_MS;
  return Math.max(DEFAULT_RPC_TIMEOUT_MS, wanted + RPC_TIMEOUT_MARGIN_MS);
}

/** The message a harness-side give-up must carry, so it cannot be read as a server hang. */
export function harnessCapMessage(method, ms) {
  return `timeout on ${method} after ${ms}ms — harness cap, not the server. `
    + 'Pass a larger timeout_ms in the tool arguments if the call legitimately needs longer.';
}
