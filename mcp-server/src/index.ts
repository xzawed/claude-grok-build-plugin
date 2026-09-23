/**
 * MCP server entrypoint: resolve the auth mode, then serve the tools over stdio.
 *
 * Tool registration and handlers live in `server.ts` so tests can drive them without a
 * process — the same entry/logic split as `hook-entry.ts` / `hook.ts`.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { formatStartupFailure, resolveAuthMode } from './config.js';
import { insideGrokWorker } from './env.js';
import { buildServer, defaultServerDeps } from './server.js';

async function main(): Promise<void> {
  const mode = resolveAuthMode(); // throws on invalid value → server fails fast at startup
  // A34: read here and passed in, not read inside buildServer — the test suite may itself run
  // inside a grok worker, and the in-memory tests must not inherit that. test/worker-guard.test.ts
  // drives the built bundle to prove this line is wired.
  const insideWorker = insideGrokWorker(process.env);
  await buildServer(mode, defaultServerDeps, { insideWorker }).connect(new StdioServerTransport());
}

main().catch((err) => {
  // A12: a configuration mistake gets one actionable line; anything else keeps its stack,
  // because there the frames ARE the diagnosis.
  const line = formatStartupFailure(err);
  if (line !== undefined) console.error(line);
  else console.error(err);
  process.exit(1);
});
