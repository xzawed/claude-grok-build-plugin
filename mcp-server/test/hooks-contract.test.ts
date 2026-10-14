/**
 * Plugin-surface contract: hooks/hooks.json matcher + command must stay aligned with
 * plugin name "grok", MCP server name "grok-build", and gated tools.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const hooksJsonPath = join(repoRoot, 'hooks/hooks.json');
const pluginJsonPath = join(repoRoot, '.claude-plugin/plugin.json');
const mcpJsonPath = join(repoRoot, '.mcp.json');

describe('hooks/hooks.json contract', () => {
  /**
   * CRITICAL (2026-07-25): bare `{ "PreToolUse": [...] }` fails Claude Code load with
   * `Hook load failed: expected record at path ["hooks"]` → **plugin failed to load**
   * → **zero slash commands**. Official plugins wrap under `{ "hooks": { ... } }`.
   */
  it('uses Claude Code plugin hooks schema (top-level hooks record, not bare events)', () => {
    expect(existsSync(hooksJsonPath)).toBe(true);
    const raw = JSON.parse(readFileSync(hooksJsonPath, 'utf8')) as Record<string, unknown>;
    // Forbidden legacy shape that Claude Code rejects for plugins:
    expect(
      raw.PreToolUse,
      'Do NOT put PreToolUse at top level — wrap under "hooks" or the entire plugin fails to load',
    ).toBeUndefined();
    expect(raw.hooks).toBeTypeOf('object');
    expect(raw.hooks).not.toBeNull();
    expect(Array.isArray(raw.hooks)).toBe(false);
  });

  it('exists and matches PreToolUse deny-only-when-certain wiring', () => {
    expect(existsSync(hooksJsonPath)).toBe(true);
    // Claude Code plugin schema requires a top-level `hooks` record (not bare PreToolUse).
    const root = JSON.parse(readFileSync(hooksJsonPath, 'utf8')) as {
      hooks?: {
        PreToolUse?: Array<{
          matcher?: string;
          hooks?: Array<{ type?: string; command?: string }>;
        }>;
      };
    };
    expect(root.hooks, 'hooks.json must wrap events under { "hooks": { ... } }').toBeTruthy();
    expect(root.hooks!.PreToolUse?.length).toBeGreaterThan(0);
    const entry = root.hooks!.PreToolUse![0];
    // Plugin name "grok" + server "grok-build" → mcp__plugin_grok_grok-build__…
    expect(entry.matcher).toBe(
      'mcp__plugin_grok_grok-build__(grok_build_(delegate|plan|verify)|grok_cli)',
    );
    const cmd = entry.hooks?.[0]?.command ?? '';
    expect(entry.hooks?.[0]?.type).toBe('command');
    expect(cmd).toContain('mcp-server/dist/hook.js');
    expect(cmd).toContain('${CLAUDE_PLUGIN_ROOT}');
    expect(cmd).toMatch(/\bnode\b/);
  });

  it('plugin.json name and .mcp.json server id stay stable for matcher', () => {
    const plugin = JSON.parse(readFileSync(pluginJsonPath, 'utf8')) as { name: string };
    const mcp = JSON.parse(readFileSync(mcpJsonPath, 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(plugin.name).toBe('grok');
    expect(Object.keys(mcp.mcpServers)).toContain('grok-build');
  });

  /**
   * A67 (v0.2.44, docs/releases/v0.2.44.md): the description called every grok_cli call without a prompt a "read-only
   * query", but the gate exempts every call mayRunTurn clears — `memory clear` and `sessions delete` among them
   * (prompt-flags.ts). 0.2.44 shipped the corrected text; this fails 0.2.44 or any later release whose description
   * says "read-only quer…" again — it checks those words, not the exact text.
   */
  it('no release after 0.2.43 still calls a grok_cli call without a prompt a read-only query (A67)', () => {
    const { version } = JSON.parse(readFileSync(join(repoRoot, 'mcp-server/package.json'), 'utf8')) as { version: string };
    const [major, minor, patch] = version.split('.').map(Number);
    const after0243 = major > 0 || minor > 2 || (minor === 2 && patch > 43);
    const { description } = JSON.parse(readFileSync(hooksJsonPath, 'utf8')) as { description?: string };
    if (after0243) {
      expect(description ?? '', `${version} ships hooks.json — keep the description 0.2.44 shipped (A67, docs/releases/v0.2.44.md)`)
        .not.toMatch(/read-only quer/i);
    }
  });
});
