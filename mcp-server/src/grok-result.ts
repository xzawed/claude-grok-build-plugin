import type { GrokResult } from './types.js';

// grok --output-format json prints one object: { text, stopReason, thought, sessionId, requestId }.
// See docs/specs/grok-cli-contract.md.
export function parseGrokResult(stdout: string): GrokResult {
  const obj = JSON.parse(stdout) as {
    text?: unknown;
    stopReason?: unknown;
    sessionId?: unknown;
  };
  const result: GrokResult = {
    text: typeof obj.text === 'string' ? obj.text : '',
    stopReason: typeof obj.stopReason === 'string' ? obj.stopReason : '',
  };
  if (typeof obj.sessionId === 'string' && obj.sessionId.length > 0) {
    result.sessionId = obj.sessionId;
  }
  return result;
}
