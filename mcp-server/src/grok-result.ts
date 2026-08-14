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

export function parseGrokResult(stdout: string): GrokResult {
  const obj = JSON.parse(stdout) as {
    text?: unknown;
    stopReason?: unknown;
    sessionId?: unknown;
    type?: unknown;
    message?: unknown;
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
  return result;
}
