import type { GrokResult } from './types.js';

// Success shape: { text, stopReason, thought, sessionId, requestId }.
// Unauthenticated modern grok (2026-07-25): { type: "error", message: "Not signed in..." }.
// See docs/specs/grok-cli-contract.md §7.

/**
 * grok 0.2.x emitted ACP PascalCase (`EndTurn`); 1.0.x emits snake_case (`end_turn`).
 * Parser keeps the raw string; classification uses this.
 */
export function isSuccessfulStopReason(stopReason: string): boolean {
  const key = stopReason.trim().toLowerCase().replace(/-/g, '_');
  return key === 'end_turn' || key === 'endturn';
}

/** A number only when grok actually stated one — never a default, never a derived sum. */
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * B3: the token counts grok 1.0.30 already puts on every envelope.
 *
 * `input` and `cacheRead` are DISJOINT halves of one input total, not two piles to add: measured
 * 2026-09-22, 25641 + 27648 = 53289, which is exactly the `inputTokens` that `grok usage <id>`
 * reports for the same session. `reasoning` is a SUBSET of `output` (158 < 270 in that capture),
 * so it must never be summed on top of it. Both fields are kept under grok's own names and no
 * total is computed here — `total` is grok's, so a caller cannot accidentally invent a different
 * one. Anything that needs a sum should state which fields it added.
 */
function readTokens(u: unknown): GrokResult['tokens'] {
  if (typeof u !== 'object' || u === null) return undefined;
  const o = u as Record<string, unknown>;
  const t = {
    input: num(o.input_tokens),
    cacheRead: num(o.cache_read_input_tokens),
    output: num(o.output_tokens),
    reasoning: num(o.reasoning_tokens),
    total: num(o.total_tokens),
  };
  return Object.values(t).some((v) => v !== undefined) ? t : undefined;
}

/**
 * The model id the run RECORDED, which is not the one `grok models` advertises: measured
 * 2026-09-22, `-m grok-4.7` produced a `modelUsage` key of `grok-4.7-build`, and the catalog
 * never lists that name. Reporting the catalog label would name a model that did not run.
 *
 * Takes the first key only. A single headless turn records one model; if grok ever reports
 * several, naming one of them is still true, while merging them into a synthetic name is not.
 */
function readModel(u: unknown): string | undefined {
  if (typeof u !== 'object' || u === null) return undefined;
  const keys = Object.keys(u as Record<string, unknown>);
  return keys.length > 0 ? keys[0] : undefined;
}

export function parseGrokResult(stdout: string): GrokResult {
  const obj = JSON.parse(stdout) as {
    text?: unknown;
    stopReason?: unknown;
    sessionId?: unknown;
    type?: unknown;
    message?: unknown;
    usage?: unknown;
    num_turns?: unknown;
    modelUsage?: unknown;
  };

  // Explicit error envelope (not signed in / other fatal CLI errors).
  if (obj.type === 'error') {
    const msg = typeof obj.message === 'string' ? obj.message : '';
    return {
      text: msg,
      stopReason: 'Error',
      isError: true,
    };
  }

  const result: GrokResult = {
    text: typeof obj.text === 'string' ? obj.text : '',
    stopReason: typeof obj.stopReason === 'string' ? obj.stopReason : '',
  };
  if (typeof obj.sessionId === 'string' && obj.sessionId.length > 0) {
    result.sessionId = obj.sessionId;
  }
  // B3. Each is set only when grok stated it, so a 1.0.13-era envelope stays exactly as quiet as
  // before. No USD field is carried: on a subscription login that number is not money the user
  // was charged, and the envelope says nothing about which billing applied. `grok usage
  // <SESSION_ID>` prints it for anyone who wants it.
  const tokens = readTokens(obj.usage);
  if (tokens) result.tokens = tokens;
  const turns = num(obj.num_turns);
  if (turns !== undefined) result.turns = turns;
  const model = readModel(obj.modelUsage);
  if (model) result.model = model;
  return result;
}
