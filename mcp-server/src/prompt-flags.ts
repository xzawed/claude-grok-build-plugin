/**
 * Which grok arguments make a run spend a subscription turn.
 *
 * A leaf module ON PURPOSE: no imports. Both the MCP server (`grok-cli.ts`) and the PreToolUse
 * hook (`hook.ts`) need this answer, and the hook is a separate ~8KB bundle that must not drag in
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
 * Short flags that carry no value, so a cluster may continue past them.
 *
 * FOUND BY GROK reviewing the first version of this parser: it matched whole tokens only, so
 * `["-vp","x"]` found no prompt — while grok's clap parser reads that as `-v -p x` and runs a
 * turn. MEASURED on 1.0.13: `grok -vp` exits 2 with "a value is required for '--single <PROMPT>'",
 * which is clap resolving the cluster, and `grok -sp` fails UUID validation for `-s p`. Clustering
 * is real, and the gate has to see through it.
 */
const BOOLEAN_SHORTS = new Set(['v', 'h']);

/** A single-dash cluster like `-vp` or `-vpHello`; `--x` and `-p` alone are handled elsewhere. */
const SHORT_CLUSTER = /^-[A-Za-z][A-Za-z]+$/;

/**
 * The prompt a passthrough carries, or undefined when it carries none.
 *
 * `--prompt-file`/`--prompt-json` name a file whose CONTENT is the prompt; we do not open it, so
 * the recorded preview says which file it was rather than inventing text we never read.
 *
 * Only CONFIDENT reads are returned. `-vp x` is confident (`v` takes no value, so `p` owns the
 * next token). `-mp x` is not: `-m` takes a value, so that is `--model p` and there is no prompt
 * at all — but a reader cannot be sure without a flag table this repo does not own. Ambiguity is
 * `mayRunTurn`'s job, not this function's; here, saying nothing beats naming the wrong prompt.
 */
export function extractPromptRun(args: string[]): { prompt: string } | undefined {
  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (!tok.startsWith('-')) continue;

    if (!tok.startsWith('--') && SHORT_CLUSTER.test(tok)) {
      const chars = tok.slice(1);
      let at = 0;
      while (at < chars.length && BOOLEAN_SHORTS.has(chars[at])) at += 1;
      if (chars[at] !== 'p') continue;
      const attached = chars.slice(at + 1);
      const value = attached.length > 0 ? attached : args[i + 1];
      if (value !== undefined) return { prompt: value };
      continue;
    }

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

/**
 * Could this invocation spend a subscription turn? The AUTH GATE's question, and a deliberately
 * wider one than `extractPromptRun`'s.
 *
 * The two differ only on clusters this parser cannot resolve confidently — `-mp x` is almost
 * certainly `--model p`, but "almost certainly" is not what an auth gate runs on, and grok's flag
 * table is a snapshot of a CLI that updates itself. So an unresolved cluster containing `p` is
 * gated (you must be signed in) and not recorded (we cannot name its prompt). Over-gating costs a
 * signed-in user nothing; under-gating spends their quota without a check.
 */
export function mayRunTurn(args: string[]): boolean {
  if (extractPromptRun(args) !== undefined) return true;
  return args.some((t) => SHORT_CLUSTER.test(t) && t.includes('p'));
}
