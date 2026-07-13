import { describe, it, expect } from 'vitest';
import { summarizeHistory } from '../src/usage.js';
import type { HistoryEntry } from '../src/history.js';

const mk = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  ts: '2026-07-13T00:00:00.000Z', mode: 'subscription', billing: 'subscription',
  status: 'completed', cwd: '/p', promptPreview: 'do x',
  filesChanged: [], filesTruncated: false, filesCount: 0, durationMs: 1, ...over,
});

describe('summarizeHistory', () => {
  it('aggregates counts by mode/billing/status and special modes + files', () => {
    const s = summarizeHistory([
      mk({ ts: '2026-07-13T00:00:01.000Z', filesCount: 2 }),
      mk({ ts: '2026-07-13T00:00:02.000Z', mode: 'api', billing: 'metered_api', status: 'grok_error' }),
      mk({ ts: '2026-07-13T00:00:03.000Z', plan: true }),
      mk({ ts: '2026-07-13T00:00:04.000Z', check: true, filesCount: 1 }),
      mk({ ts: '2026-07-13T00:00:05.000Z', worktreePath: '/wt', filesCount: 3 }),
    ]);
    expect(s.total).toBe(5);
    expect(s.byMode).toEqual({ subscription: 4, api: 1 });
    expect(s.byBilling).toEqual({ subscription: 4, metered_api: 1 });
    expect(s.byStatus).toEqual({ completed: 4, auth_error: 0, timeout: 0, grok_error: 1 });
    expect(s.counts).toEqual({ plan: 1, check: 1, worktree: 1 });
    expect(s.totalFilesChanged).toBe(6);
    expect(s.firstTs).toBe('2026-07-13T00:00:01.000Z');
    expect(s.lastTs).toBe('2026-07-13T00:00:05.000Z');
  });
  it('recent respects limit and is most-recent-first', () => {
    const entries = Array.from({ length: 5 }, (_, i) => mk({ ts: `2026-07-13T00:00:0${i}.000Z`, promptPreview: `p${i}` }));
    const s = summarizeHistory(entries, { limit: 2 });
    expect(s.recent.map((r) => r.promptPreview)).toEqual(['p4', 'p3']);
  });
  it('filters by cwd', () => {
    const s = summarizeHistory([mk({ cwd: '/a' }), mk({ cwd: '/b' }), mk({ cwd: '/a' })], { cwd: '/a' });
    expect(s.total).toBe(2);
  });
  it('empty input yields zeros and no timestamps', () => {
    const s = summarizeHistory([]);
    expect(s.total).toBe(0);
    expect(s.byStatus).toEqual({ completed: 0, auth_error: 0, timeout: 0, grok_error: 0 });
    expect(s.firstTs).toBeUndefined();
    expect(s.recent).toEqual([]);
  });
});
