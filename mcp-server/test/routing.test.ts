import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeTask, inferSignalsFromTask } from '../src/routing.js';
import { planNextAction } from '../src/orchestrator.js';

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

describe('route-decision-examples.json fixtures', () => {
  it('matches expected worker/risk/nextAction for documented orchestrator samples', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '..', '..', 'docs', 'specs', 'samples', 'route-decision-examples.json');
    const doc = JSON.parse(readFileSync(path, 'utf8')) as {
      examples: Array<{
        name: string;
        input: Parameters<typeof routeTask>[0];
        expected: {
          risk: string;
          worker: string;
          suggestedTool?: string;
          nextAction?: {
            phase: string;
            tool?: string;
            requiresHumanGateBeforeDelegate?: boolean;
          };
        };
      }>;
    };
    for (const ex of doc.examples) {
      const d = routeTask(ex.input);
      expect(d.risk, ex.name).toBe(ex.expected.risk);
      expect(d.worker, ex.name).toBe(ex.expected.worker);
      if (ex.expected.suggestedTool) {
        expect(d.suggestedTool, ex.name).toBe(ex.expected.suggestedTool);
      }
      if (ex.expected.nextAction) {
        const n = planNextAction(d);
        expect(n.phase, ex.name).toBe(ex.expected.nextAction.phase);
        if (ex.expected.nextAction.tool) {
          expect(n.tool, ex.name).toBe(ex.expected.nextAction.tool);
        }
        if (ex.expected.nextAction.requiresHumanGateBeforeDelegate) {
          expect(n.requiresHumanGateBeforeDelegate, ex.name).toBe(true);
        }
      }
    }
  });
});

// ── Audit finding, 2026-09-02. ────────────────────────────────────────────────────────

describe('inferSignalsFromTask bulk (audit: the pattern matched ordinary prose)', () => {
  // `n files` was meant as "N files" but was an unanchored substring, so it fired inside
  // "in files", "on files", "broken files"; `every ` fired on "on every request". A bulk
  // signal skips the weak-LOW downgrade, so one accidental match routed a debugging task
  // straight to LOW / grok / delegate — inverting the module's own fail-closed lean.
  it('does not flag prose that merely contains the letters "n files" or "every "', () => {
    for (const t of [
      'Fix the null deref shown in files during startup',
      'Debug why the parser crashes on files with a BOM',
      'Explain the broken files warning',
      'Fix the retry loop that runs on every request',
      'Investigate the deadlock we see every time the queue drains',
    ]) {
      expect(inferSignalsFromTask(t).bulk, t).toBeUndefined();
    }
  });

  it('still flags genuine bulk work', () => {
    for (const t of [
      'migrate all files to the new import path',
      'rename the logger call across the repo',
      'update 40 files to the new API',
      'apply this to every module in the workspace',
      '전 파일 일괄 변경',
    ]) {
      expect(inferSignalsFromTask(t).bulk, t).toBe(true);
    }
  });

  it('routes an unsignalled debugging task away from an unattended delegate', () => {
    const d = routeTask({ task: 'Fix the null deref shown in files during startup' });
    expect(d.risk).not.toBe('LOW');
  });
});

// MEASURED 2026-09-05 service audit. Every case below was reproduced against the shipped bundle
// before the fix, so these are recorded failures, not hypotheticals.
describe('danger routing (audit FAIL 3 and 4)', () => {
  it('scores a Korean security task the same as its English twin', () => {
    // Was MEDIUM in Korean / HIGH in English: `security` was the only rule of nine with no
    // Korean alternates, in a product whose every user-facing string is Korean.
    expect(routeTask({ task: '운영 서버의 인증 토큰 발급 로직을 바꿔라' }).risk).toBe('HIGH');
    expect(routeTask({ task: 'change the auth token issuing logic on the production server' }).risk).toBe('HIGH');
  });

  it('a bulk word no longer carries a Korean security task down to LOW', () => {
    // Adding 마이그레이션 (bulk) used to skip the weak-LOW demotion → LOW / unattended delegate.
    const d = routeTask({ task: '운영 데이터베이스의 비밀번호 해시를 argon2로 마이그레이션해라' });
    expect(d.risk).toBe('HIGH');
    expect(d.worker).toBe('claude');
  });

  it('never delegates an irreversible production operation', () => {
    // The measured worst case: "migrate" set bulk, and nothing else fired at all.
    const d = routeTask({
      task: 'migrate the production customer database to the new schema and drop the old columns',
    });
    expect(d.risk).toBe('HIGH');
    expect(d.worker).toBe('claude');
    expect(d.suggestedTool).toBeUndefined();
  });

  it('floors a single danger signal at MEDIUM even with bulk signals present', () => {
    const d = routeTask({ task: 'truncate the analytics table across all 40 files' });
    expect(d.risk).toBe('MEDIUM');
    expect(d.suggestedTool).toBe('grok_build_plan');
  });

  it('does not over-block ordinary work that merely says production or drop', () => {
    expect(routeTask({ task: 'drop support for IE11 and backfill unit tests for every module' }).risk).toBe('LOW');
    expect(routeTask({ task: 'rename toSnakeCase to to_snake_case across all 40 files' }).risk).toBe('LOW');
  });

  it('an explicit false cannot switch off a danger the text states', () => {
    // A struct serializer that fills every field would otherwise disable the net for a session.
    const d = routeTask({
      task: 'drop the old columns on the production database',
      signals: { destructive: false, production: false, bulk: true, lowRiskDomain: true },
    });
    expect(d.risk).toBe('HIGH');
  });
});
