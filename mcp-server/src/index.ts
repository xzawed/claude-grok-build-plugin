import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolveAuthMode } from './config.js';
import { checkAuth, defaultAuthDeps } from './auth.js';
import { runDelegate } from './delegate.js';
import { recordDelegation } from './history.js';

async function main(): Promise<void> {
  const mode = resolveAuthMode(); // throws on invalid value → server fails fast at startup

  const server = new McpServer({ name: 'grok-build', version: '0.1.0' });

  server.registerTool(
    'grok_auth_check',
    {
      description: 'Check whether Grok Build is authenticated for the active auth mode. Does not delegate.',
      inputSchema: z.object({}),
    },
    async () => {
      const result = checkAuth(mode, defaultAuthDeps());
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !result.ok };
    },
  );

  server.registerTool(
    'grok_build_delegate',
    {
      description: 'Delegate a coding task to Grok Build; returns a summary, changed files, and billing mode.',
      inputSchema: z.object({
        prompt: z.string().describe('Task instruction for grok (English recommended).'),
        cwd: z.string().describe('Absolute path of the working directory.'),
        timeout_ms: z.number().int().positive().optional().describe('Default 180000 (3 min).'),
        worktree: z.boolean().optional().describe('Run grok in a fresh isolated git worktree from HEAD; changes land there (not in cwd) for review. Returns worktreePath.'),
        sandbox: z.string().optional().describe('grok --sandbox <profile> for filesystem/network limits (grok-native; profile names unverified).'),
      }),
    },
    async ({ prompt, cwd, timeout_ms, worktree, sandbox }) => {
      const pre = checkAuth(mode, defaultAuthDeps());
      if (!pre.ok) {
        return { content: [{ type: 'text', text: pre.message }], isError: true };
      }
      const input = { prompt, cwd, timeoutMs: timeout_ms, worktree, sandbox };
      const t0 = Date.now();
      const result = await runDelegate(mode, input);
      recordDelegation(input, result, { ts: new Date().toISOString(), durationMs: Date.now() - t0 });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: result.status !== 'completed',
      };
    },
  );

  server.registerTool(
    'grok_build_plan',
    {
      description: 'Ask Grok Build for a plan/approach for a task WITHOUT editing any files (read-only preview). Use before grok_build_delegate to preview grok\'s approach; returns a plan summary.',
      inputSchema: z.object({
        prompt: z.string().describe('Task instruction for grok (English recommended).'),
        cwd: z.string().describe('Absolute path of the working directory.'),
        timeout_ms: z.number().int().positive().optional().describe('Default 180000 (3 min).'),
      }),
    },
    async ({ prompt, cwd, timeout_ms }) => {
      const pre = checkAuth(mode, defaultAuthDeps());
      if (!pre.ok) {
        return { content: [{ type: 'text', text: pre.message }], isError: true };
      }
      const input = { prompt, cwd, timeoutMs: timeout_ms, plan: true };
      const t0 = Date.now();
      const result = await runDelegate(mode, input);
      recordDelegation(input, result, { ts: new Date().toISOString(), durationMs: Date.now() - t0 });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: result.status !== 'completed',
      };
    },
  );

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
