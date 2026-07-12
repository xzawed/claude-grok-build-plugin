import type { GrokResult } from './types.js';

// grok --output-format json prints one object: { text, stopReason, thought, sessionId, requestId }.
// See docs/specs/grok-cli-contract.md.
export function parseGrokResult(stdout: string): GrokResult {
  const obj = JSON.parse(stdout) as { text?: unknown; stopReason?: unknown };
  return {
    text: typeof obj.text === 'string' ? obj.text : '',
    stopReason: typeof obj.stopReason === 'string' ? obj.stopReason : '',
  };
}
