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
 * A2 (docs/10, MEASURED 2026-09-05, re-verified against 1.0.30 2026-09-22): `-p, --single
 * <PROMPT>`, `--prompt-file <PATH>` and `--prompt-json <JSON>` are the complete set of single-turn
 * prompt flags that `--help` lists. A62 (MEASURED 2026-10-09 on 1.0.44): `--print` is one it does not —
 * clap names it "--single <PROMPT>" in its errors — and a `grok_cli` run spelled with it went past this
 * gate and the recorder while grok ran the turn. The hidden flags are in contract §16. 1.0.92 (MEASURED
 * 2026-11-28, synthetic session, 404 loopback) writes `-p, --single [<PROMPT>]`, the same set: a following token is
 * taken as the value unless it starts with "-" (`promptFlagTakes`), and with none grok reads the prompt from stdin, which
 * grok_cli never gives (`grok: -p -: prompt is empty`, exit 1, no request) — so a lone `-p`/`--single` spends no turn,
 * and the gate below stays as it is: a prompt flag before a token it does not take is still a prompt run here.
 *
 * ⚠️ What this gate exempts is "spends no subscription turn" — NOT "read-only", which is what the
 * comment here used to claim. On 1.0.30 the exempt set includes `plugin install <git url>`,
 * `setup`, `doctor fix`, `memory clear`, `sessions delete` and `worktree rm|gc`: none of them
 * calls the model, and every one of them changes state on disk or on the account. That is the
 * correct boundary for an AUTH gate — being signed in is irrelevant to whether `worktree rm`
 * should run — but anyone reading this to decide what a passthrough may do unattended must take
 * the exemption for what it is. `grok_cli` is a documented passthrough (`/grok:cli`), so the
 * containment that matters for those commands is NON_HEADLESS in `grok-cli.ts`, not this gate.
 * "Spends no turn" is also the gate's judgement, not a guarantee: `--memory-flush` carries no prompt
 * flag yet, with memory on, called the model on grok 1.0.44 (A63). This gate still lets it through; since
 * v0.2.52 `grok_cli` refuses any run that carries it without a prompt flag (help and version excepted),
 * before any spawn (`memoryFlushRun` in grok-cli.ts).
 */
const PROMPT_FLAGS = new Set(['-p', '--single', '--print', '--prompt-file', '--prompt-json']);

/**
 * Short flags that carry no value, so a cluster may continue past them.
 *
 * FOUND BY GROK reviewing the first version of this parser: it matched whole tokens only, so
 * `["-vp","x"]` found no prompt — while grok's clap parser reads that as `-v -p x` and runs a
 * turn. MEASURED on 1.0.13: `grok -vp` exits 2 with "a value is required for '--single <PROMPT>'",
 * which is clap resolving the cluster, and `grok -sp` fails UUID validation for `-s p`. Clustering
 * is real, and the gate has to see through it.
 */
/*
 * A28 (MEASURED 2026-09-22 end-to-end through the shipped v0.2.25 bundle on grok 1.0.30):
 * `c` was missing, so `-cp "…"` — which clap reads as `-c -p "…"`, i.e. --continue plus a real
 * single-turn prompt — landed on `c`, failed the `!== 'p'` test, and was recorded nowhere. The
 * run itself completed and was billed: history rows went 848 -> 848 while stdout came back "ok".
 *
 * This is the RECORDER's set, and the recorder may use a snapshot: a `p` it cannot land on is
 * still inside the leading-letter run that `mayRunTurn` checks, so the auth gate never depended
 * on this set being complete (re-measured the same day against dist/hook.js with an empty
 * GROK_HOME: `-cp x` denied exactly like `-p x`). Staleness here costs a missing history row,
 * never an ungated turn.
 *
 * Complete for 1.0.30: the value-less shorts are `-c/--continue`, `-v/--version`, `-h/--help`.
 * `-w/--worktree` and `-r/--resume` are deliberately absent — both take an OPTIONAL value, so
 * skipping past them could land on a `p` that is somebody else's value and name a fictional
 * prompt. The recorder refuses to guess (see `-mp x` below); leaving them out keeps that promise.
 */
// 1.0.92 added `-f`, a switch (`-fx` failed on `-x`, measured 2026-11-28), so `-fp x` is `-f -p x` (A83).
const BOOLEAN_SHORTS = new Set(['c', 'v', 'h', 'f']);

/**
 * A single-dash token whose first character is an option letter: `-p`, `-vp`, `-vpHello`, `-p2+2`.
 *
 * A24 (docs/10, MEASURED 2026-09-06 through the shipped bundle): this used to be
 * `/^-[A-Za-z][A-Za-z]+$/` — the WHOLE token had to be letters. That holds only when the attached
 * VALUE happens to be alphabetic, so `-p2+2`, `-p/tmp/x` and `-pfoo.txt` matched nothing here and
 * slipped past the recorder AND the auth gate at the same time. clap reads `-p2+2` exactly as
 * `-p 2+2`: measured, both forms sent with a bogus `--model` came back with the SAME "unknown
 * model id" error, so grok took the attached token as the flag rather than as a stray argument.
 */
const SHORT_TOKEN = /^-[A-Za-z]/;

/**
 * The run of option letters at the front of a short token, before any attached value.
 *
 * The `p` that matters is an OPTION letter. A `p` sitting inside an attached value —
 * `-s01a0p619-…` — is data, and gating on it would put a call with no prompt flag behind the auth gate for no reason.
 */
const LEADING_LETTERS = /^[A-Za-z]+/;

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
 *
 * `at` is the index of the token that carries the prompt flag, `valueAt` the index of the token that holds its value
 * (`at` itself when the value is attached or after `=`), and `file` says the preview names a file rather than holding
 * the text: grok-cli.ts's `promptGrokSends` uses them to rebuild what grok 1.0.92 really sends (A80).
 */
export function extractPromptRun(args: string[]): { prompt: string; at: number; valueAt: number; file: boolean } | undefined {
  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (!tok.startsWith('-')) continue;

    if (!tok.startsWith('--') && SHORT_TOKEN.test(tok)) {
      const chars = tok.slice(1);
      let at = 0;
      while (at < chars.length && BOOLEAN_SHORTS.has(chars[at])) at += 1;
      if (chars[at] !== 'p') continue;
      // clap takes a short option's value attached (`-pVALUE`) or joined by `=` (`-p=VALUE`).
      // `rest` decides whether a value was attached AT ALL; `attached` is that value with the
      // separator removed, so `-p=` still reads as an empty prompt rather than eating the next
      // token. Nothing attached means the value is the next argument, as before.
      const rest = chars.slice(at + 1);
      const attached = rest.startsWith('=') ? rest.slice(1) : rest;
      if (rest.length > 0) return { prompt: attached, at: i, valueAt: i, file: false };
      const next = args[i + 1];
      if (next === undefined) continue;
      // A token grok does not take as the value leaves the flag without one: still a prompt run (the auth gate,
      // `mayRunTurn`, reads it so), whose prompt is the words around it.
      return promptFlagTakes(next) ? { prompt: next, at: i, valueAt: i + 1, file: false } : { prompt: '', at: i, valueAt: i, file: false };
    }

    const eq = tok.indexOf('=');
    const name = eq >= 0 ? tok.slice(0, eq) : tok;
    if (!PROMPT_FLAGS.has(name)) continue;
    const value = eq >= 0 ? tok.slice(eq + 1) : args[i + 1];
    if (name === '--prompt-file' || name === '--prompt-json') {
      return { prompt: `(${name}${value ? ` ${value}` : ''})`, at: i, valueAt: eq >= 0 ? i : i + 1, file: true };
    }
    if (value === undefined) continue;
    if (eq < 0 && !promptFlagTakes(value)) return { prompt: '', at: i, valueAt: i, file: false };
    return { prompt: value, at: i, valueAt: eq >= 0 ? i : i + 1, file: false };
  }
  return undefined;
}

/**
 * Whether grok takes `next`, the token after a separated `-p`, `--single` or `--print`, as that flag's value.
 *
 * 1.0.92 writes `-p, --single [<PROMPT>]`: the value is optional, and clap takes a separated token as it only when the
 * token does not start with "-" — a lone "-" (stdin) excepted. MEASURED 2026-11-28 (synthetic session, 404 loopback):
 * `-p --always-approve Say`, `--single --output-format json Say` and `--print --always-approve Say` each sent "Say";
 * `-p -- Say` sent what follows `--`; `-p --help` and `--single --version` printed and exited 0 with no request; `-p -`
 * read stdin ("grok: -p -: prompt is empty"). 1.0.70, whose value was required, ended every hyphen-led one "a value is
 * required for '--single <PROMPT>'", exit 2. `--prompt-file` and `--prompt-json` still require theirs (the same message
 * on 1.0.92), so this is not asked of them.
 */
export function promptFlagTakes(next: string | undefined): next is string {
  return next !== undefined && (next === '-' || !next.startsWith('-'));
}

/**
 * The index of a `-p` (alone or ending a cluster of switches), `--single` or `--print` that ends the arguments, or
 * undefined. `extractPromptRun` names no prompt for it — there is no value — but on 1.0.92 the words before it are the
 * prompt: `Say -p`, `Say --single` and `Say --print` each sent "Say" headless (A82, MEASURED 2026-11-28, synthetic
 * session, 404 loopback). Whether words stand before it takes a flag table this leaf module does not hold, so the auth
 * gate counts every such run and grok-cli.ts decides the rest.
 */
export function trailingPromptFlag(args: string[]): number | undefined {
  const at = args.length - 1;
  const tok = args[at];
  if (tok === undefined) return undefined;
  if (tok === '--single' || tok === '--print') return at;
  if (tok.startsWith('--') || !SHORT_TOKEN.test(tok)) return undefined;
  const chars = tok.slice(1);
  let i = 0;
  while (i < chars.length && BOOLEAN_SHORTS.has(chars[i])) i += 1;
  return chars[i] === 'p' && i === chars.length - 1 ? at : undefined;
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
  if (extractPromptRun(args) !== undefined || trailingPromptFlag(args) !== undefined) return true;
  return args.some((t) => {
    if (t.startsWith('--') || !SHORT_TOKEN.test(t)) return false;
    return (LEADING_LETTERS.exec(t.slice(1))?.[0] ?? '').includes('p');
  });
}
