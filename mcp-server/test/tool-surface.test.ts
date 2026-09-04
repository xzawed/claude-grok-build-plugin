/**
 * Dist packaging integrity: every MCP tool we document must actually be REGISTERED in the
 * committed bundle, so install-time users don't get a silent tool gap.
 *
 * The original check tested for the name as a quoted string anywhere in the bundle, which
 * routing.ts and orchestrator.ts satisfy on their own for the three hook-gated tools. It is now
 * a registerTool() call-site check, in both the bundle and the source, as an exact set.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const distIndex = join(here, '../dist/index.js');
const distHook = join(here, '../dist/hook.js');
// Registrations moved to src/server.ts in v0.2.17 so tests can drive the handlers;
// index.ts is now just the stdio entrypoint. esbuild still inlines both into dist/index.js.
const srcRegistrations = join(here, '../src/server.ts');

/** SSOT list of tools registered in src/server.ts — keep in sync when adding tools. */
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
    expect(src).toMatch(/const defaultRunGit: GitRunner = async \(args, timeoutMs\) => \{\s*await runGitBounded\(args, timeoutMs\);/);
    // and the checkout-sized calls must ask for the bulk budget, not the metadata one
    expect(src).toMatch(/worktree., .add., path.*GIT_BULK_TIMEOUT_MS/);
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

// ── Audit 2, 2026-09-03. The presence check above passes if a name appears ANYWHERE in the
// bundle as a quoted string — and routing.ts / orchestrator.ts embed 'grok_build_delegate',
// 'grok_build_plan' and 'grok_build_verify' as routing-advice literals, which esbuild inlines
// into the same file. Measured: deleting the whole registerTool('grok_build_verify', …) block
// and rebuilding left the entire suite green, including CI's dist-freshness step. Precisely the
// three tools the PreToolUse hook gates were the three the gate could not protect.
describe('dist tool surface — registration, not mere presence', () => {
  const registered = (src: string): string[] =>
    [...src.matchAll(/registerTool\(\s*["']([A-Za-z0-9_]+)["']/g)].map((m) => m[1]);

  it('every expected tool appears as an actual registerTool call argument', () => {
    const names = registered(readFileSync(distIndex, 'utf8'));
    for (const name of EXPECTED_MCP_TOOLS) {
      expect(names, name).toContain(name);
    }
  });

  it('the bundle registers exactly the expected set — no extras, no gaps', () => {
    const names = registered(readFileSync(distIndex, 'utf8')).sort();
    expect(names).toEqual([...EXPECTED_MCP_TOOLS].sort());
  });

  it('the source registers the same set the bundle does', () => {
    const srcNames = registered(readFileSync(srcRegistrations, 'utf8')).sort();
    expect(srcNames).toEqual([...EXPECTED_MCP_TOOLS].sort());
  });
});
