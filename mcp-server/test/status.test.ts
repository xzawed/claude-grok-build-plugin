import { describe, it, expect } from 'vitest';
import { buildStatusSnapshot } from '../src/status.js';
import { summarizeHistory } from '../src/usage.js';
import type { AuthCheckResult } from '../src/types.js';
import type { HistoryEntry } from '../src/history.js';

const authOk: AuthCheckResult = {
  ok: true,
  mode: 'subscription',
  billing: 'subscription',
  serverVersion: '0.2.2',
  message: '구독 세션 인증 준비됨.',
};

const authBad: AuthCheckResult = {
  ok: false,
  mode: 'subscription',
  billing: 'subscription',
  serverVersion: '0.2.2',
  reason: 'not_logged_in',
  message: '구독 로그인이 필요합니다.',
};

const mk = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  ts: '2026-07-25T00:00:00.000Z',
  mode: 'subscription',
  billing: 'subscription',
  status: 'completed',
  cwd: '/p',
  promptPreview: 'x',
  filesChanged: [],
  filesTruncated: false,
  filesCount: 0,
  durationMs: 1,
  ...over,
});

describe('buildStatusSnapshot', () => {
  it('not ready → setup next step, no lastSession pressure', () => {
    const usage = summarizeHistory([]);
    const s = buildStatusSnapshot(authBad, usage);
    expect(s.ready).toBe(false);
    expect(s.reason).toBe('not_logged_in');
    expect(s.nextSteps.some((t) => /setup|login/i.test(t))).toBe(true);
    expect(s.totalDelegations).toBe(0);
  });

  it('ready + empty history → tour/delegate first win', () => {
    const s = buildStatusSnapshot(authOk, summarizeHistory([]));
    expect(s.ready).toBe(true);
    expect(s.billing).toBe('subscription');
    expect(s.serverVersion).toBe('0.2.2');
    expect(s.nextSteps.some((t) => /tour|delegate|첫/.test(t))).toBe(true);
  });

  it('ready + history with sessionId → resume + review tips', () => {
    const usage = summarizeHistory([
      mk({ sessionId: 'sid-9', ts: '2026-07-25T01:00:00.000Z' }),
      mk({ status: 'completed', ts: '2026-07-25T02:00:00.000Z', sessionId: 'sid-latest' }),
    ]);
    const s = buildStatusSnapshot(authOk, usage);
    expect(s.totalDelegations).toBe(2);
    expect(s.lastSession?.sessionId).toBe('sid-latest');
    expect(s.nextSteps.some((t) => /resume/i.test(t))).toBe(true);
    expect(s.nextSteps.some((t) => /review/i.test(t))).toBe(true);
    expect(s.usageHeadline).toMatch(/위임/);
  });
});
