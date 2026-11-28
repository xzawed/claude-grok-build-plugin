/**
 * MCP server entrypoint: resolve the auth mode, then serve the tools over stdio.
 *
 * Tool registration and handlers live in `server.ts` so tests can drive them without a
 * process — the same entry/logic split as `hook-entry.ts` / `hook.ts`.
 *
 * `serveStdio` (MCP SDK v2) serves BOTH protocol eras from one factory: a 2025-era client opens with `initialize`, a
 * 2026-07-28 client with `server/discover`, and the opening exchange pins the connection's era
 * (docs/specs/2026-11-28-mcp-v2-dual-protocol-design.md). `legacy: 'reject'` is deliberately not passed.
 */
// First, so its body runs before any SDK module's: the SDK v2 needs Node.js 20 (node-guard.ts).
import './node-guard.js';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { formatStartupFailure, resolveAuthMode } from './config.js';
import { insideGrokWorker } from './env.js';
import { buildServer, defaultServerDeps } from './server.js';

// `async` with no `await` on purpose: a throw inside (resolveAuthMode's, A12) becomes the rejection `.catch` below turns
// into one line. A plain function would throw before `.catch` is attached, and the stack would reach the user instead.
async function main(): Promise<void> {
  const mode = resolveAuthMode(); // throws on invalid value → server fails fast at startup
  // A34: read here and passed in, not read inside buildServer — the test suite may itself run
  // inside a grok worker, and the in-memory tests must not inherit that. test/worker-guard.test.ts
  // drives the built bundle to prove this line is wired.
  const insideWorker = insideGrokWorker(process.env);
  serveStdio(() => buildServer(mode, defaultServerDeps, { insideWorker }));
}

main().catch((err) => {
  // A12: a configuration mistake gets one actionable line; anything else keeps its stack,
  // because there the frames ARE the diagnosis.
  const line = formatStartupFailure(err);
  if (line !== undefined) console.error(line);
  else console.error(err);
  process.exit(1);
});
