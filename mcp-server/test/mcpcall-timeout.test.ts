/**
 * Contract for the audit harness's RPC timeout (`.claude/tools/rpc-timeout.mjs`).
 *
 * WHY THIS EXISTS — MEASURED 2026-09-13, during a full audit.
 * `.claude/tools/mcpcall.mjs` is the harness `docs/10` prescribes for reproducing defects
 * against the shipped bundle. It hardcoded a 240 s RPC timeout and never looked at the tool
 * arguments' own `timeout_ms`, so:
 *
 *   node .claude/tools/mcpcall.mjs call grok_build_delegate '{"cwd":…,"timeout_ms":900000}'
 *
 * was cut off at exactly 240 s (start 21:24:33, end 21:28:33) and reported
 * "TRANSPORT FAILURE: timeout on tools/call" — indistinguishable from a server hang or a slow
 * model. Proven to be the harness and not the server by setting the constant to 1 ms, which
 * made the very first `initialize` fail on a call that normally returns in milliseconds.
 *
 * That is the A26 failure mode wearing different clothes: A26 fixed the harness noticing a dead
 * child, but left the timer itself unable to represent a legitimately long call. A harness that
 * silently overrides the caller's cap falsifies evidence for whoever trusts the procedure.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RPC_TIMEOUT_MS, RPC_TIMEOUT_MARGIN_MS, rpcTimeoutMs, harnessCapMessage } from '../../.claude/tools/rpc-timeout.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const mcpcallPath = join(repoRoot, '.claude/tools/mcpcall.mjs');

describe('audit harness RPC timeout', () => {
  it('honours a tool call that asks for longer than the default', () => {
    // The exact payload from the reproduction above.
    expect(rpcTimeoutMs('tools/call', { timeout_ms: 900_000 })).toBeGreaterThanOrEqual(900_000);
  });

  it('outlives the tool cap by a margin, so the server reports its own timeout first', () => {
    // The server turns its own cap into a structured `status: "timeout"` result, which is far
    // more useful than a transport error. The harness must therefore lose the race on purpose.
    expect(rpcTimeoutMs('tools/call', { timeout_ms: 900_000 })).toBe(900_000 + RPC_TIMEOUT_MARGIN_MS);
  });

  it('keeps the old default when no timeout_ms is given', () => {
    expect(rpcTimeoutMs('tools/call', {})).toBe(DEFAULT_RPC_TIMEOUT_MS);
    expect(rpcTimeoutMs('tools/list', {})).toBe(DEFAULT_RPC_TIMEOUT_MS);
    expect(rpcTimeoutMs('initialize', undefined)).toBe(DEFAULT_RPC_TIMEOUT_MS);
  });

  it('never shortens below the default, whatever the caller passes', () => {
    // A tool cap of 5 s must not leave the harness 5 s to spawn a server and get an answer.
    expect(rpcTimeoutMs('tools/call', { timeout_ms: 5_000 })).toBe(DEFAULT_RPC_TIMEOUT_MS);
  });

  it('ignores junk instead of trusting it', () => {
    for (const junk of [0, -1, NaN, Infinity, 'lots', null, {}]) {
      expect(rpcTimeoutMs('tools/call', { timeout_ms: junk as never })).toBe(DEFAULT_RPC_TIMEOUT_MS);
    }
  });

  it('mcpcall.mjs derives its timer from this module, not from a literal', () => {
    const src = readFileSync(mcpcallPath, 'utf8');
    expect(src, 'mcpcall must import the shared timeout rule').toContain('rpc-timeout.mjs');
    expect(src, 'mcpcall must call rpcTimeoutMs').toContain('rpcTimeoutMs(');
    // The regression this pins: a bare 240_000 back in the rpc() call would silently restore
    // the cap that swallowed a 900 s request.
    expect(src.includes('240_000')).toBe(false);
  });

  it('a harness cap is reported as a harness cap, not as a bare timeout', () => {
    // Whoever reads the failure must be able to tell "the harness gave up" from "the server
    // hung" — that distinction is the whole point of this fix. Assert the message itself, and
    // separately that mcpcall is the thing emitting it.
    const msg = harnessCapMessage('tools/call', 900_000);
    expect(msg).toContain('harness cap');
    expect(msg).toContain('900000');
    expect(msg).toContain('timeout_ms');
    expect(readFileSync(mcpcallPath, 'utf8')).toContain('harnessCapMessage(');
  });
});
