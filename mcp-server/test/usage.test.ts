import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  summarizeHistory, readHistory, buildUsageInsights, latestResumableSession, normalizeCwd,
} from '../src/usage.js';
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
  it('recent carries sessionId when present on history entries', () => {
    const s = summarizeHistory([
      mk({ ts: '2026-07-13T00:00:01.000Z', sessionId: 'sid-1' }),
      mk({ ts: '2026-07-13T00:00:02.000Z' }),
    ], { limit: 2 });
    expect(s.recent[0].sessionId).toBeUndefined();
    expect(s.recent[1].sessionId).toBe('sid-1');
  });
  it('lastSession is the newest row with sessionId (cwd-aware)', () => {
    const s = summarizeHistory([
      mk({ ts: '2026-07-13T00:00:01.000Z', cwd: '/a', sessionId: 'old' }),
      mk({ ts: '2026-07-13T00:00:02.000Z', cwd: '/b', sessionId: 'other' }),
      mk({ ts: '2026-07-13T00:00:03.000Z', cwd: '/a', sessionId: 'new-a' }),
      mk({ ts: '2026-07-13T00:00:04.000Z', cwd: '/a' }), // no sessionId
    ], { cwd: '/a' });
    expect(s.lastSession?.sessionId).toBe('new-a');
    expect(s.lastSession?.cwd).toBe('/a');
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
    expect(s.insights.tips.join(String.fromCharCode(10))).not.toMatch(/우회|샌 것/);
  });
  it('the all-metered tip names the server setting, never a leaked key', () => {
    // This is the branch whose string changed: metered > 0 AND subscription === 0.
    const tips = summarizeHistory([mk({ billing: 'metered_api', mode: 'api' }), mk({ billing: 'metered_api', mode: 'api' })])
      .insights.tips.join(String.fromCharCode(10));
    expect(tips).toMatch(/metered_api/);
    expect(tips).toMatch(/GROK_BUILD_AUTH_MODE/);
    expect(tips).not.toMatch(/우회|샌 것/);
  });
  it('limit 0 (or negative) yields an empty recent list', () => {
    expect(summarizeHistory([mk(), mk()], { limit: 0 }).recent).toEqual([]);
    expect(summarizeHistory([mk(), mk()], { limit: -3 }).recent).toEqual([]);
  });
});

describe('latestResumableSession', () => {
  it('returns undefined when none have sessionId', () => {
    expect(latestResumableSession([mk(), mk({ sessionId: '' })])).toBeUndefined();
  });
  it('picks newest with non-empty sessionId', () => {
    const h = latestResumableSession([
      mk({ ts: '2026-07-13T00:00:01.000Z', sessionId: 'a' }),
      mk({ ts: '2026-07-13T00:00:02.000Z', sessionId: 'b' }),
    ]);
    expect(h?.sessionId).toBe('b');
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

// MEASURED 2026-09-05 on a real 1779-row history: exact string equality on cwd hid 386 rows
// (21.7%). One project carried four spellings, so /grok:status reported 205 or 37 or 28
// delegations for the same directory depending on how the caller spelled it.
describe('cwd filtering across spellings (audit FAIL 2)', () => {
  const rows = (cwds: string[]): HistoryEntry[] =>
    cwds.map((cwd, i) => ({
      ts: `2026-09-0${i + 1}T00:00:00.000Z`,
      cwd,
      status: 'completed',
      mode: 'subscription',
      billing: 'subscription',
      durationMs: 10,
    })) as unknown as HistoryEntry[];

  const spellings = [
    String.raw`f:\DEV\Proj`,
    String.raw`F:\DEV\Proj`,
    'f:/DEV/Proj',
    'F:/DEV/Proj/',
  ];

  it('treats separator, case and trailing slash as the same directory on win32', () => {
    for (const s of spellings) {
      expect(normalizeCwd(s, 'win32')).toBe('f:/dev/proj');
    }
  });

  it('keeps case significant on posix, where two casings are two directories', () => {
    expect(normalizeCwd('/srv/A', 'linux')).not.toBe(normalizeCwd('/srv/a', 'linux'));
    expect(normalizeCwd('/srv/a/', 'linux')).toBe('/srv/a');
  });

  it('counts every spelling of one directory once, whichever the caller passes', () => {
    const entries = rows(spellings);
    for (const asked of spellings) {
      expect(summarizeHistory(entries, { cwd: asked }).total).toBe(spellings.length);
    }
  });

  it('finds a resumable session written under a different spelling', () => {
    const entries = rows([String.raw`f:\DEV\Proj`]).map((e) => ({ ...e, sessionId: 'sess-1' }));
    expect(latestResumableSession(entries, { cwd: 'f:/DEV/Proj/' })?.sessionId).toBe('sess-1');
  });
});

// CI caught this: keying case folding off the HOST made the same history file answer differently
// on Linux than on Windows. A Windows-shaped path is Windows-shaped wherever it is read.
describe('cwd normalization is host-independent', () => {
  it('folds a Windows-shaped path even when running on linux', () => {
    expect(normalizeCwd(String.raw`F:\DEV\Proj`, 'linux')).toBe(normalizeCwd('f:/DEV/Proj', 'linux'));
    expect(normalizeCwd('F:/DEV/Proj/', 'linux')).toBe('f:/dev/proj');
  });
  it('still refuses to fold a POSIX path on linux', () => {
    expect(normalizeCwd('/srv/A', 'linux')).not.toBe(normalizeCwd('/srv/a', 'linux'));
  });
});
