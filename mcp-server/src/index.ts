/**
 * MCP server entrypoint: resolve the auth mode, then serve the tools over stdio.
 *
 * Tool registration and handlers live in `server.ts` so tests can drive them without a
 * process — the same entry/logic split as `hook-entry.ts` / `hook.ts`.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveAuthMode } from './config.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const mode = resolveAuthMode(); // throws on invalid value → server fails fast at startup
  await buildServer(mode).connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
