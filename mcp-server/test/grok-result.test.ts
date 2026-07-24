import { describe, it, expect } from 'vitest';
import { parseGrokResult } from '../src/grok-result.js';

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
