/**
 * Dist packaging integrity: every MCP tool name we document must appear in the
 * committed bundle so install-time users don't get a silent tool gap.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const distIndex = join(here, '../dist/index.js');
const distHook = join(here, '../dist/hook.js');

/** SSOT list of tools registered in src/index.ts — keep in sync when adding tools. */
export const EXPECTED_MCP_TOOLS = [
  'grok_auth_check',
  'grok_build_delegate',
  'grok_build_plan',
  'grok_build_verify',
  'grok_build_usage',
  'grok_build_status',
  'grok_build_worktree',
  'grok_build_route',
  'grok_cli',
] as const;

describe('dist tool surface', () => {
  it('committed bundles exist', () => {
    expect(existsSync(distIndex)).toBe(true);
    expect(existsSync(distHook)).toBe(true);
  });

  it('dist/index.js registers every expected MCP tool name', () => {
    const src = readFileSync(distIndex, 'utf8');
    for (const name of EXPECTED_MCP_TOOLS) {
      expect(src.includes(`"${name}"`) || src.includes(`'${name}'`), name).toBe(true);
    }
    expect(EXPECTED_MCP_TOOLS.length).toBe(9);
  });

  it('dist/hook.js includes PreToolUse deny contract markers', () => {
    const src = readFileSync(distHook, 'utf8');
    expect(src).toMatch(/permissionDecision/);
    expect(src).toMatch(/PreToolUse/);
  });
});
