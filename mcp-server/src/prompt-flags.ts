/**
 * Which grok arguments make a run spend a subscription turn.
 *
 * A leaf module ON PURPOSE: no imports. Both the MCP server (`grok-cli.ts`) and the PreToolUse
 * hook (`hook.ts`) need this answer, and the hook is a separate 6KB bundle that must not drag in
 * the delegation engine to get it. Importing it from `grok-cli.ts` transitively inlined
 * `delegate.ts` and `worktree.ts` into `dist/hook.js` — measured 6,612 -> 9,660 bytes, with
 * `spawn` and the worktree lifecycle along for the ride. Harmless today; a top-level side effect
 * in either of those files would run on every PreToolUse invocation tomorrow.
 *
 * A2 (docs/10, MEASURED 2026-09-05): verified against `grok --help` on 1.0.13 — `-p, --single
 * <PROMPT>`, `--prompt-file <PATH>` and `--prompt-json <JSON>` are the complete set of single-turn
 * prompt flags. Everything else (`sessions list`, `models`, `inspect`, `--version`) is a read-only
 * query that spends nothing.
 */
const PROMPT_FLAGS = new Set(['-p', '--single', '--prompt-file', '--prompt-json']);

/**
 * The prompt a passthrough carries, or undefined when it carries none.
 *
 * `--prompt-file`/`--prompt-json` name a file whose CONTENT is the prompt; we do not open it, so
 * the recorded preview says which file it was rather than inventing text we never read.
 */
export function extractPromptRun(args: string[]): { prompt: string } | undefined {
  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (!tok.startsWith('-')) continue;
    const eq = tok.indexOf('=');
    const name = eq >= 0 ? tok.slice(0, eq) : tok;
    if (!PROMPT_FLAGS.has(name)) continue;
    const value = eq >= 0 ? tok.slice(eq + 1) : args[i + 1];
    if (name === '--prompt-file' || name === '--prompt-json') {
      return { prompt: `(${name}${value ? ` ${value}` : ''})` };
    }
    if (value !== undefined) return { prompt: value };
  }
  return undefined;
}
