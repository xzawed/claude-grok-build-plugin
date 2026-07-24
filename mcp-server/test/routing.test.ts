import { describe, it, expect } from 'vitest';
import { routeTask, inferSignalsFromTask } from '../src/routing.js';

describe('inferSignalsFromTask', () => {
  it('flags security keywords', () => {
    expect(inferSignalsFromTask('fix JWT auth middleware').security).toBe(true);
  });
  it('flags bulk migrate language', () => {
    expect(inferSignalsFromTask('migrate all files to new import path').bulk).toBe(true);
  });
});

describe('routeTask', () => {
  it('HIGH: security wins over bulk', () => {
    const d = routeTask({
      signals: { bulk: true, lowRiskDomain: true, security: true },
    });
    expect(d.risk).toBe('HIGH');
    expect(d.worker).toBe('claude');
    expect(d.suggestedTool).toBeUndefined();
    expect(d.reasons.some((r) => /보안/.test(r))).toBe(true);
  });

  it('HIGH: architecture / final review', () => {
    expect(routeTask({ signals: { architecture: true } }).worker).toBe('claude');
    expect(routeTask({ signals: { finalReview: true } }).worker).toBe('claude');
  });

  it('LOW: bulk + low risk → grok delegate/verify', () => {
    const d = routeTask({ signals: { bulk: true, lowRiskDomain: true } });
    expect(d.risk).toBe('LOW');
    expect(d.worker).toBe('grok');
    expect(d.suggestedTool).toBe('grok_build_verify');
    expect(d.suggestedFlags?.worktree).toBe(true);
  });

  it('LOW: bulk alone is enough', () => {
    const d = routeTask({ signals: { bulk: true } });
    expect(d.risk).toBe('LOW');
    expect(d.worker).toBe('grok');
    expect(d.suggestedTool).toBe('grok_build_delegate');
  });

  it('MEDIUM: no signals → plan_then_grok', () => {
    const d = routeTask({ task: 'do something vague' });
    expect(d.risk).toBe('MEDIUM');
    expect(d.worker).toBe('plan_then_grok');
    expect(d.suggestedTool).toBe('grok_build_plan');
  });

  it('MEDIUM: metered billing requires stronger LOW signals', () => {
    const d = routeTask({ signals: { exploratory: true }, meteredBilling: true });
    expect(d.risk).toBe('MEDIUM');
    expect(d.worker).toBe('plan_then_grok');
  });

  it('task text can drive LOW without explicit signals', () => {
    const d = routeTask({ task: 'unit test backfill for the parser module' });
    expect(d.worker).toBe('grok');
    expect(d.risk).toBe('LOW');
  });

  it('task text security forces Claude', () => {
    const d = routeTask({ task: 'bulk rename plus fix OAuth token storage' });
    expect(d.worker).toBe('claude');
    expect(d.risk).toBe('HIGH');
  });

  it('always includes no-auto-commit safety note', () => {
    const d = routeTask({ signals: { bulk: true } });
    expect(d.safetyNotes.some((n) => /커밋/.test(n))).toBe(true);
  });
});
