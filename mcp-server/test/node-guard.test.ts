/**
 * The MCP SDK v2 (`@modelcontextprotocol/server`) requires Node.js 20+ (its `engines`), and this server now runs on it
 * (docs/specs/2026-11-28-mcp-v2-dual-protocol-design.md §6.2). On an older Node the SDK's own code may fail with a
 * stack that says nothing about the cause, so src/node-guard.ts — evaluated before any SDK module — ends the start
 * with one line in the same shape as formatStartupFailure's. These assertions hold the decision function; the bundle's
 * real start on an old Node is measured separately (the design's matrix row 5).
 */
import { describe, it, expect } from 'vitest';
import { nodeTooOld } from '../src/node-guard.js';

describe('nodeTooOld — the Node 20 floor of the MCP SDK v2', () => {
  it.each([['18.20.4'], ['19.9.0'], ['16.20.2']])('refuses Node %s with one line that names the floor and the version', (v) => {
    const line = nodeTooOld(v);
    expect(line).toBeDefined();
    expect(line).not.toContain('\n');
    expect(line).toContain('grok-build MCP server did not start');
    expect(line).toContain('Node.js 20');
    expect(line).toContain(v);
  });

  it.each([['20.0.0'], ['20.19.5'], ['22.18.0'], ['24.1.0']])('lets Node %s through', (v) => {
    expect(nodeTooOld(v)).toBeUndefined();
  });

  // A runtime that reports something this cannot read is let through: the SDK then decides, which is what happened
  // before this guard existed. Refusing it would block a host we have never measured.
  it.each([[''], ['unknown'], ['v22.1.0']])('does not refuse a version it cannot read: %j', (v) => {
    expect(nodeTooOld(v)).toBeUndefined();
  });
});
