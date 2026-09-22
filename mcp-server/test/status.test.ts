import { describe, it, expect } from 'vitest';
import { buildStatusSnapshot } from '../src/status.js';
import { summarizeHistory } from '../src/usage.js';
import type { AuthCheckResult } from '../src/types.js';
import type { HistoryEntry } from '../src/history.js';

const authOk: AuthCheckResult = {
  ok: true,
  mode: 'subscription',
  billing: 'subscription',
  serverVersion: '0.2.4',
  message: '구독 세션 인증 준비됨.',
};

const authBad: AuthCheckResult = {
  ok: false,
  mode: 'subscription',
  billing: 'subscription',
  serverVersion: '0.2.4',
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
    expect(s.serverVersion).toBe('0.2.4');
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
    expect(s.billingMismatch).toBeUndefined();
  });

  it('subscription mode + metered history → billingMismatch tip', () => {
    const usage = summarizeHistory([
      mk({ billing: 'subscription', ts: '2026-07-25T01:00:00.000Z' }),
      mk({
        billing: 'metered_api', mode: 'api', status: 'completed',
        ts: '2026-07-25T02:00:00.000Z',
      }),
    ]);
    const s = buildStatusSnapshot(authOk, usage);
    expect(s.billingMismatch).toBe(true);
    expect(s.tips[0]).toMatch(/metered_api/);
    // The tag is billingFor(mode), so a metered entry means GROK_BUILD_AUTH_MODE was api —
    // it can never mean a shell key leaked past the subscription strip.
    expect(s.tips[0]).toMatch(/GROK_BUILD_AUTH_MODE/);
    expect(s.tips[0]).not.toMatch(/샌|우회|override/);
    expect(s.nextSteps.some((t) => /과금|auth-strategy/.test(t))).toBe(true);
  });

  // AUDITED BY GROK 2026-09-22. Claim put to it: "this function can report a state that is not the
  // state the user is actually in." Half of the answer was wrong — Grok said nothing records the
  // mode those past runs used, but `billing` IS billingFor(mode) by construction (absolute
  // principle #1), so a metered row proves the mode was api then, and the tip says exactly that.
  // The tip is accurate and stays.
  //
  // The other half holds. `billingMismatch` is a fact about HISTORY; the nextStep phrased it as a
  // present blocker — "과금 경로를 먼저 정리한 뒤 위임을 재개하세요". A user who already switched
  // back to subscription has nothing to fix, and is told to fix it before resuming. The detection
  // is untouched: docs/10 §C's "4×2 전부 정확" measured the FLAG, not this sentence.
  it('does not tell a user in subscription mode to fix a billing path that is already right', () => {
    const usage = summarizeHistory([
      mk({ billing: 'metered_api', mode: 'api', status: 'completed', ts: '2026-07-25T02:00:00.000Z' }),
    ]);
    const s = buildStatusSnapshot(authOk, usage);
    // The observation is still surfaced — it is genuinely useful and otherwise baffling.
    expect(s.billingMismatch).toBe(true);
    expect(s.tips[0]).toMatch(/metered_api/);
    // But the instruction must not claim the CURRENT path is broken.
    const billingStep = s.nextSteps.find((t) => /과금|auth-strategy/.test(t)) ?? '';
    expect(billingStep).not.toMatch(/재개하세요/);
    expect(billingStep).toMatch(/이력|지난|과거/);
  });
});
