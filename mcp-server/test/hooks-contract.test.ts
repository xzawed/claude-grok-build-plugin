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
      'mcp__plugin_grok_grok-build__grok_build_(delegate|plan|verify)',
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
});
