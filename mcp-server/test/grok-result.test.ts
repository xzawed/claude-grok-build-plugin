import { describe, it, expect } from 'vitest';
import { isSuccessfulStopReason, parseGrokResult } from '../src/grok-result.js';

describe('parseGrokResult', () => {
  it('extracts text, stopReason, and sessionId from grok --output-format json', () => {
    const stdout = JSON.stringify({
      text: 'Created `hi.txt`.',
      stopReason: 'EndTurn',
      thought: 'internal reasoning',
      sessionId: 's', requestId: 'r',
    });
    const r = parseGrokResult(stdout);
    expect(r.text).toBe('Created `hi.txt`.');
    expect(r.stopReason).toBe('EndTurn');
    expect(r.sessionId).toBe('s');
  });
  it('tolerates surrounding whitespace/newlines', () => {
    const r = parseGrokResult('\n  {"text":"ok","stopReason":"EndTurn"}\n');
    expect(r.stopReason).toBe('EndTurn');
  });
  it('falls back safely when text/stopReason are missing', () => {
    const r = parseGrokResult(JSON.stringify({ sessionId: 's' }));
    expect(r.text).toBe('');
    expect(r.stopReason).toBe('');
  });
  it('throws on non-JSON stdout', () => {
    expect(() => parseGrokResult('not json at all')).toThrow();
  });
  it('treats 1.0 snake_case end_turn and legacy EndTurn as success', () => {
    expect(isSuccessfulStopReason('end_turn')).toBe(true);
    expect(isSuccessfulStopReason('EndTurn')).toBe(true);
    expect(isSuccessfulStopReason('END_TURN')).toBe(true);
    expect(isSuccessfulStopReason('cancelled')).toBe(false);
    expect(isSuccessfulStopReason('Cancelled')).toBe(false);
    expect(isSuccessfulStopReason('')).toBe(false);
  });
  // B3 — the envelope below is a VERBATIM capture from grok 1.0.30 (2026-09-22, subscription
  // login), trimmed only in `text`/`thought`. Everything this parser used to throw away is in it.
  //
  // Arithmetic verified independently before these expectations were written:
  //   input_tokens + cache_read_input_tokens          = 25641 + 27648 = 53289
  //     … which is exactly what `grok usage <id>` reports as inputTokens for the same session,
  //     so the two envelope fields are DISJOINT parts of one input total, not a sum to re-add.
  //   in + cacheRead + cacheCreation + out            = 53559 = total_tokens ✓
  //   reasoning_tokens 158 < output_tokens 270        → a SUBSET of output, never an addend
  //   total_cost_usd * 1e10 = 226868400 = total_cost_usd_ticks (same number, fixed point)
  const REAL_1_0_30 = JSON.stringify({
    text: 'Created `p1.txt`.',
    stopReason: 'end_turn',
    sessionId: '01a0c8f3-49bf-7813-9d84-558adb42ff15',
    requestId: '90485ee2-0c82-4d16-a522-b42e015fd24f',
    thought: '…',
    usage: {
      input_tokens: 25641,
      cache_read_input_tokens: 27648,
      cache_creation_input_tokens: 0,
      output_tokens: 270,
      reasoning_tokens: 158,
      total_tokens: 53559,
    },
    num_turns: 2,
    total_cost_usd: 0.02268684,
    total_cost_usd_ticks: 226868400,
    modelUsage: {
      'grok-4.7-build': {
        inputTokens: 25641, outputTokens: 270, cacheReadInputTokens: 27648,
        cacheCreationInputTokens: 0, modelCalls: 2, costUSD: 0.02268684,
      },
    },
  });

  it('keeps the token counts, turn count and model the 1.0.30 envelope already carries', () => {
    const r = parseGrokResult(REAL_1_0_30);
    expect(r.tokens).toEqual({
      input: 25641, cacheRead: 27648, output: 270, reasoning: 158, total: 53559,
    });
    expect(r.turns).toBe(2);
    expect(r.model).toBe('grok-4.7-build');
  });

  // `grok models` advertises `grok-4.7` as the default and never lists `grok-4.7-build`. The
  // envelope is what the run actually recorded, so report that and do not collapse the two —
  // measured the same day: `-m grok-4.7` resolves to a modelUsage key of `grok-4.7-build`.
  it('reports the model the run recorded, not the catalog name', () => {
    expect(parseGrokResult(REAL_1_0_30).model).not.toBe('grok-4.7');
  });

  // Deliberately absent. On a subscription login the USD figure is not money the user was
  // charged, and the envelope carries no field saying which billing applied — `billing` on the
  // delegate result does, and it is derived from the configured mode, not observed here. Surfacing
  // an unbilled list price as "cost" is the one mistake this field could cause. `grok usage
  // <SESSION_ID>` prints it for anyone who wants it (unblocked by A30).
  it('does not surface a USD figure', () => {
    expect(JSON.stringify(parseGrokResult(REAL_1_0_30))).not.toMatch(/0\.02268684|costUsd|costUSD/);
  });

  it('stays quiet on a 1.0.13-era envelope that has none of these fields', () => {
    const r = parseGrokResult(JSON.stringify({ text: 'ok', stopReason: 'end_turn' }));
    expect(r.tokens).toBeUndefined();
    expect(r.turns).toBeUndefined();
    expect(r.model).toBeUndefined();
  });

  it('ignores a modelUsage that is empty or not an object (never invents a model)', () => {
    expect(parseGrokResult(JSON.stringify({ text: 'x', stopReason: 'end_turn', modelUsage: {} })).model).toBeUndefined();
    expect(parseGrokResult(JSON.stringify({ text: 'x', stopReason: 'end_turn', modelUsage: 7 })).model).toBeUndefined();
  });

  it('parses type:error unauth envelope (2026-07-25)', () => {
    const r = parseGrokResult(JSON.stringify({
      type: 'error',
      message: 'Not signed in. run grok login --device-code',
    }));
    expect(r.isError).toBe(true);
    expect(r.stopReason).toBe('Error');
    expect(r.text).toMatch(/Not signed in/);
  });
});
