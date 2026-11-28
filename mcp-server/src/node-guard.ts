/**
 * The Node.js floor of the MCP SDK v2 — `@modelcontextprotocol/server` declares `engines: { node: '>=20' }`.
 *
 * src/index.ts imports this module FIRST, so in the esbuild bundle its body runs before any SDK module's: on an older
 * Node the SDK's own code may fail with a stack that names no cause. The line has formatStartupFailure's shape
 * (config.ts): "grok-build MCP server did not start: …". A version this cannot read is let through — the SDK decides
 * then, as it did before this guard (docs/specs/2026-11-28-mcp-v2-dual-protocol-design.md §6.2; the bundle's start on
 * an old Node is the design's measurement row 5).
 */
const FLOOR = 20;

export function nodeTooOld(version: string): string | undefined {
  const major = /^(\d+)\.\d+\.\d+/.exec(version)?.[1];
  if (major === undefined || Number(major) >= FLOOR) return undefined;
  return `grok-build MCP server did not start: Node.js ${FLOOR} or newer is required (this is Node.js ${version}). `
    + 'Update Node.js, then restart Claude Code.';
}

const refusal = nodeTooOld(process.versions.node);
if (refusal !== undefined) {
  console.error(refusal);
  process.exit(1);
}
