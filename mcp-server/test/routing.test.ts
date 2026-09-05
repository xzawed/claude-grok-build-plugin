import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeTask, inferSignalsFromTask, type RouteSignals } from '../src/routing.js';
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

// Cases from Grok's adversarial review of the first draft of the danger gate. It found both
// failure directions in one pass, so they are pinned here rather than described.
describe('danger gate — the counter-examples that broke the first draft', () => {
  it('does not fire on Korean words that merely CONTAIN a danger stem', () => {
    // `드롭` is a substring of `드롭다운`(dropdown) and `초기화`(initialize) is everyday Korean
    // for resetting form state. Korean has no word boundaries, so short stems are substring traps.
    for (const task of [
      '단일 파일에 드롭다운 컴포넌트 boilerplate를 추가해라',
      '폼 상태 초기화 로직에 unit test를 백필해라',
    ]) {
      expect(inferSignalsFromTask(task).destructive).toBeUndefined();
      expect(routeTask({ task }).risk).toBe('LOW');
    }
  });

  it('does not fire on English verbs used non-destructively', () => {
    expect(inferSignalsFromTask('purge unused CSS and scaffold boilerplate for every component').destructive).toBeUndefined();
    expect(inferSignalsFromTask('truncate the log string to 80 chars in every component').destructive).toBeUndefined();
    expect(inferSignalsFromTask('drop support for IE11 and backfill unit tests for every module').destructive).toBeUndefined();
  });

  it('catches the shapes real infrastructure damage takes', () => {
    // None of these matched the first draft; each routed LOW or ungated.
    for (const task of [
      'migrate 40 files then terraform destroy against the prod workspace',
      'aws s3 rb s3://prod-customer-backups --force',
      'dropdb customer_live',
    ]) {
      expect(routeTask({ task }).risk).toBe('HIGH');
    }
    // Destructive without a production noun still gets a gate, just not the top one.
    expect(routeTask({ task: 'kubectl delete namespace --all in prod' }).risk).toBe('MEDIUM');
  });

  it('reads live resources named as identifiers, not only as prose', () => {
    expect(inferSignalsFromTask('restore prod-customer-backups').production).toBe(true);
    expect(inferSignalsFromTask('point the app at customer_live').production).toBe(true);
  });
});

// Second adversarial round. Grok re-attacked the tightened gate and declared it unfit to ship;
// every case below is one it found, and each is pinned so the next tightening cannot reopen it.
describe('danger gate — second adversarial round', () => {
  it('a Korean UI noun is not a dropped table', () => {
    // `테이블 드롭다운`(table dropdown) contains both halves of "drop table".
    const task = '목차 테이블 드롭다운을 단일 파일에 boilerplate로 추가해라';
    expect(inferSignalsFromTask(task).destructive).toBeUndefined();
    expect(routeTask({ task }).risk).toBe('LOW');
  });

  it('resetting a schema helper or a form is not destroying a database', () => {
    expect(inferSignalsFromTask('zod 스키마 초기화 헬퍼에 unit test를 백필해라').destructive).toBeUndefined();
    // 초기화 counts only for a database, never for a schema/form/state.
    expect(inferSignalsFromTask('운영 디비 초기화하고 새 스키마로 마이그레이션').destructive).toBe(true);
  });

  it('reads the negation instead of the word inside it', () => {
    // 비프로덕션 / non-production mean the OPPOSITE and used to raise the risk.
    expect(inferSignalsFromTask('비프로덕션 환경용 DTO를 scaffold 해라').production).toBeUndefined();
    expect(inferSignalsFromTask('seed the non-production database with fixtures').production).toBeUndefined();
    expect(inferSignalsFromTask('write the go-live checklist docs only').production).toBeUndefined();
  });

  it('deleting code is not deleting data', () => {
    // "delete all unused imports" is ordinary cleanup; the object has to be data.
    expect(inferSignalsFromTask('delete all unused imports across 40 files').destructive).toBeUndefined();
    expect(inferSignalsFromTask('delete the records older than 30 days').destructive).toBe(true);
  });

  it('catches Korean particles and the DB abbreviation', () => {
    // `운영 DB` is at least as common as `운영 디비`, and 은/는/도 are as valid as 를/을.
    expect(routeTask({ task: '운영 DB를 드롭하고 40개 파일 마이그레이션해라' }).risk).toBe('HIGH');
    expect(inferSignalsFromTask('테이블은 드롭하고 스키마를 새로 만들어라').destructive).toBe(true);
  });

  it('gates the other destroy shapes even without a production noun', () => {
    for (const task of [
      'pulumi destroy the staging stack then migrate 40 files',
      'aws s3 rm --recursive s3://customer-backups then migrate 40 files',
      'rails db:drop and migrate 40 files',
      'rm -fr ./data && migrate 40 files',
    ]) {
      expect(routeTask({ task }).risk).not.toBe('LOW');
    }
  });
});

// A1 (docs/10, MEASURED 2026-09-05 against the shipped 0.2.19 bundle): v0.2.19 made only
// `destructive`/`production` un-switchable, so the other five HIGH keys were still cancellable by
// an explicit `false`. The three payloads below are the audit's, verbatim:
//   {task}                                  → HIGH
//   {task, signals:{security:false}}         → MEDIUM   ← the bug
//   {task, signals:<every field filled>}     → LOW      ← the bug, at full strength
// A Go struct without omitempty, or a Python `asdict`, sends `security:false` on EVERY call, so
// one serializer default disarmed the keyword net for a whole session with no intent to disable it.
describe('A1 — an explicit false cannot switch off ANY danger the text states', () => {
  const dangerTasks: Record<string, string> = {
    security: 'rotate the OAuth client secret and update the auth middleware',
    regulated: 'update the HIPAA medical records export',
    architecture: 'make the architecture decision on the new API shape',
    monorepoWide: 'apply the fix across all packages in the monorepo',
    finalReview: 'do the final review before merge approval',
  };

  for (const [key, task] of Object.entries(dangerTasks)) {
    it(`${key}: inferred true survives an explicit false`, () => {
      expect(inferSignalsFromTask(task)[key as keyof RouteSignals]).toBe(true);
      expect(routeTask({ task, signals: { [key]: false } }).risk).toBe('HIGH');
    });
  }

  it('the audit payload: a fully-populated struct cannot demote a security task', () => {
    const d = routeTask({
      task: dangerTasks.security,
      signals: {
        bulk: true, lowRiskDomain: true, narrowScope: true, exploratory: true,
        architecture: false, security: false, regulated: false,
        monorepoWide: false, finalReview: false,
      },
    });
    expect(d.risk).toBe('HIGH');
    expect(d.worker).toBe('claude');
  });

  it('still lets a caller RAISE risk the text does not state', () => {
    // One-directional: false cannot disarm, true can arm. An orchestrator that knows more than
    // the text must stay able to say so.
    expect(routeTask({ task: 'backfill unit tests for every module' }).risk).toBe('LOW');
    expect(routeTask({ task: 'backfill unit tests for every module', signals: { security: true } }).risk).toBe('HIGH');
  });

  it('still lets a caller switch off a LOW signal the text states', () => {
    // Only risk-RAISING keys are protected; demoting your own LOW signals is legitimate.
    expect(routeTask({ task: 'backfill unit tests for every module', signals: { bulk: false, lowRiskDomain: false } }).risk).toBe('MEDIUM');
  });
});

// The escape hatch the one-directional rule implies, found by Grok's adversarial pass on the A1
// fix (2026-09-05): with the fix, "change the password field label in the login form docs only"
// is HIGH forever — `비밀번호`/`password` fires `security` and no signal can take it back. That is
// the intended trade-off, but a consumer who genuinely knows better needs a way out, and there is
// exactly one: send `signals` WITHOUT `task`. No text, no inference, nothing to override.
describe('A1 — the escape hatch for a caller who really does know better', () => {
  it('signals without task are honoured in full (nothing to infer from)', () => {
    expect(routeTask({ signals: { lowRiskDomain: true, narrowScope: true, bulk: true } }).risk).toBe('LOW');
  });

  it('the same signals WITH the text stay gated — that is the point', () => {
    const task = 'change the password field label in the login form, docs only';
    expect(routeTask({ task, signals: { lowRiskDomain: true, narrowScope: true, bulk: true } }).risk).toBe('HIGH');
  });
});
