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

/**
 * Wiring contract: the leak fixes in v0.2.10 live in `defaultSpawn` and the two default git
 * runners, neither of which is reachable through the DI seam the unit tests use. Their helpers
 * are unit-tested; these assertions pin that the helpers are actually WIRED IN, so reverting the
 * call site cannot leave a green suite.
 */
describe('resource-leak wiring', () => {
  const srcDelegate = join(here, '../src/delegate.ts');
  const srcWorktree = join(here, '../src/worktree.ts');

  it('defaultSpawn feeds both streams through appendBounded with the caps', () => {
    const src = readFileSync(srcDelegate, 'utf8');
    expect(src).toMatch(/stdout = appendBounded\(stdout, String\(d\), STDOUT_CAP_BYTES, 'head'\)/);
    expect(src).toMatch(/stderr = appendBounded\(stderr, String\(d\), STDERR_CAP_BYTES, 'tail'\)/);
    // and nothing is appending raw again
    expect(src).not.toMatch(/stdout \+= d;/);
    expect(src).not.toMatch(/stderr \+= d;/);
  });

  it('both default git runners go through runGitBounded', () => {
    const src = readFileSync(srcWorktree, 'utf8');
    expect(src).toMatch(/const defaultRunGit: GitRunner = async \(args\) => \{\s*await runGitBounded\(args\);/);
    expect(src).toMatch(/const defaultCaptureGit: GitCapture = \(args\) => runGitBounded\(args\);/);
    // no unbounded execFileAsync('git', args) left in this module
    expect(src).not.toMatch(/execFileAsync\('git', args\);/);
  });

  it('dist/index.js exposes the prune action so the committed bundle can reach it', () => {
    const src = readFileSync(distIndex, 'utf8');
    expect(src).toMatch(/"prune"|'prune'/);
    expect(src).toMatch(/max_age_days/);
  });
});
