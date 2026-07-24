import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarizeHistory, readHistory, buildUsageInsights } from '../src/usage.js';
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
    expect(s.insights.successRatePct).toBeNull();
    expect(s.insights.headline).toMatch(/이력이 없습니다/);
  });
  it('insights report success rate and subscription share', () => {
    const s = summarizeHistory([
      mk({ status: 'completed', billing: 'subscription' }),
      mk({ status: 'completed', billing: 'subscription' }),
      mk({ status: 'grok_error', billing: 'metered_api' }),
      mk({ status: 'timeout', billing: 'subscription' }),
    ]);
    expect(s.insights.successRatePct).toBe(50);
    expect(s.insights.subscriptionBillingPct).toBe(75);
    expect(s.insights.headline).toMatch(/위임 4건/);
    expect(s.insights.tips.length).toBeGreaterThan(0);
  });
  it('limit 0 (or negative) yields an empty recent list', () => {
    expect(summarizeHistory([mk(), mk()], { limit: 0 }).recent).toEqual([]);
    expect(summarizeHistory([mk(), mk()], { limit: -3 }).recent).toEqual([]);
  });
});

describe('buildUsageInsights', () => {
  it('empty total has onboarding headline', () => {
    const i = buildUsageInsights({
      total: 0,
      byMode: { subscription: 0, api: 0 },
      byBilling: { subscription: 0, metered_api: 0 },
      byStatus: { completed: 0, auth_error: 0, timeout: 0, grok_error: 0 },
      counts: { plan: 0, check: 0, worktree: 0 },
      totalFilesChanged: 0,
    });
    expect(i.successRatePct).toBeNull();
    expect(i.tips.length).toBeGreaterThan(0);
  });
});

describe('readHistory', () => {
  it('parses valid lines and skips malformed ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grok-usage-'));
    const path = join(dir, 'history.jsonl');
    writeFileSync(path, [
      JSON.stringify(mk({ promptPreview: 'a' })),
      'this is not json',
      '',
      JSON.stringify(mk({ promptPreview: 'b' })),
    ].join('\n'), 'utf8');
    const entries = readHistory(path);
    expect(entries.map((e) => e.promptPreview)).toEqual(['a', 'b']);
  });
  it('returns [] for a missing file', () => {
    expect(readHistory(join(tmpdir(), 'definitely-missing-xyz', 'h.jsonl'))).toEqual([]);
  });
  it('skips non-object JSON lines (null / scalar / array) so the summary never crashes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grok-usage-'));
    const path = join(dir, 'history.jsonl');
    writeFileSync(path, [
      JSON.stringify(mk({ promptPreview: 'a' })),
      'null',
      '42',
      '[1,2,3]',
      JSON.stringify(mk({ promptPreview: 'b' })),
    ].join('\n'), 'utf8');
    const entries = readHistory(path);
    expect(entries.map((e) => e.promptPreview)).toEqual(['a', 'b']);
    expect(() => summarizeHistory(entries, { cwd: '/p' })).not.toThrow();
  });
});
