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

// A43 (docs/10, MEASURED 2026-09-25 on the committed tree): four patterns in inferSignalsFromTask
// backtracked QUADRATICALLY — each 4x of input cost ~16x of time, and a 64,000-char task took 2.1–5.3 s
// per pattern. grok_build_route's `task` has no length cap and the server is one event loop, so one
// pasted document with a long whitespace or digit run stalled every tool for seconds. The linear
// rewrites were differential-tested against the originals: 0 differences in 200,000 random samples.
describe('A43 — the task scan is linear on the inputs that made it quadratic', () => {
  const worst: [string, string][] = [
    ['테이블 + 64,000 spaces', `테이블${' '.repeat(64_000)}x`],
    ['디비 + 64,000 spaces', `디비${' '.repeat(64_000)}x`],
    ['데이터 + 64,000 spaces', `데이터${' '.repeat(64_000)}x`],
    ['64,000 digits, no "files"', `${'1'.repeat(64_000)}x`],
  ];
  it.each(worst)('%s: returns in well under a second', (_label, task) => {
    const t0 = performance.now();
    inferSignalsFromTask(task);
    expect(performance.now() - t0).toBeLessThan(250);
  });

  // The rewrite must not move the language boundary: every particle and spacing the old patterns took.
  it.each([
    ['테이블 삭제', true], ['테이블을 삭제', true], ['테이블을  삭제', true], ['테이블  을 삭제', true],
    ['DB를 초기화', true], ['DB 초기화', true], ['디비는초기화', true],
    ['데이터 전부 삭제', true], ['데이터를 모두 삭제', true], ['레코드를  전부  삭제', true],
    ['테이블 드롭다운 수정', false], ['폼 상태 초기화', false], ['데이터 일부 삭제', false],
  ] as [string, boolean][])('%s → destructive %s', (task, expected) => {
    expect(inferSignalsFromTask(task).destructive === true).toBe(expected);
  });
});

// A44 (docs/10, MEASURED 2026-09-25): the English security alternation had no `token` while the Korean
// one has 토큰 — "rename the session token cookie in all files" routed LOW → grok_build_delegate
// (unattended), its Korean twin HIGH → claude. The module's stated lean is fail-closed toward Claude, and
// the 2026-09-05 fix of this same rule was about exactly this asymmetry in the other direction.
// And `\d+\s*files?` read "1 file" as bulk: "fix the race condition in 1 file" routed LOW, the same task
// without "in 1 file" MEDIUM — the digit rule's own comment says it stands for a COUNT of files.
describe('A44 — the keyword net speaks both languages and counts files', () => {
  it('an English token task scores like its Korean twin', () => {
    const ko = routeTask({ task: '세션 토큰 쿠키 이름을 일괄 변경' });
    const en = routeTask({ task: 'rename the session token cookie in all files' });
    expect(ko.risk).toBe('HIGH');
    expect(en.risk).toBe(ko.risk);
    expect(en.worker).toBe(ko.worker);
  });
  it('one file is not bulk', () => {
    expect(inferSignalsFromTask('fix the race condition in 1 file').bulk).toBeUndefined();
    expect(routeTask({ task: 'fix the race condition in 1 file' }).risk)
      .toBe(routeTask({ task: 'fix the race condition' }).risk);
  });
  it('a count of files still is', () => {
    for (const task of ['update 40 files', 'touch 2 files', 'change 12 files']) {
      expect(inferSignalsFromTask(task).bulk).toBe(true);
    }
  });
});

// The pre-merge review of A43/A44 (2026-09-25), OLD (418c1e9) vs the rewrite on the same tasks.
describe('A43/A44 pre-merge review — what the rewrite changed that it should not have', () => {
  // `(?<!\d)(?:[2-9]|[1-9]\d+)` cannot start a group after a separator, so a written-out thousand lost
  // its bulk signal: 5,914 flips in the review's differential, all bulk → not bulk.
  it.each([
    'update 1,000 files to the new import path', 'reformat 10,000 files with prettier',
    'touch 2,048 files in the fixtures', 'update 1 000 files', 'update 1.000 files', 'touch 1,000files',
  ])('a written-out thousand is a count: %s', (task) => {
    expect(inferSignalsFromTask(task).bulk).toBe(true);
  });
  it.each(['fix the race condition in 1 file', 'fix 01 file', 'there are 0 files left'])('not a count of 2+: %s', (task) => {
    expect(inferSignalsFromTask(task).bulk).toBeUndefined();
  });

  // A44 added `token` as a bare substring, so every LLM and design sense of the word went HIGH/claude.
  // Singular `token` keeps the security reading (the A44 payload), except where it counts or is split
  // into; plural `tokens` is security only after a word that says whose token it is.
  it.each([
    'refactor the tokenizer across 40 files', 'update the design tokens in 12 component files',
    'reduce max tokens for the summarizer prompt', 'count tokens in the CSV importer',
    'the token count is wrong in the usage view', 'raise max_tokens in the client config',
  ])('an LLM or design sense of the word is not a security task: %s', (task) => {
    expect(inferSignalsFromTask(task).security).toBeUndefined();
  });
  it.each([
    'rename the session token cookie in all files', 'rotate the API tokens', 'store the refresh token in an httpOnly cookie',
    'fix token expiry handling', 'refreshToken rotation in the auth client', 'revoke all refresh_tokens on logout',
  ])('a credential sense still is: %s', (task) => {
    expect(inferSignalsFromTask(task).security).toBe(true);
  });

  // Untouched by A43, and quadratic: `rm\b[^\n]*--recursive` re-read the rest of the line from every
  // `s3 rm` — 64,000 chars 307 ms, 256,000 chars 5.0 s. 132,000 chars here: the old code's 64K time sat
  // too close to the bound for a fast runner to fail it (re-review).
  it('"s3 rm " repeated stays linear, and the recursive delete is still destructive', () => {
    const t0 = performance.now();
    inferSignalsFromTask('s3 rm '.repeat(22_000));
    expect(performance.now() - t0).toBeLessThan(250);
    expect(inferSignalsFromTask('aws s3 rm s3://bucket/prefix --recursive').destructive).toBe(true);
    expect(inferSignalsFromTask('aws s3 rm s3://bucket/one-object.txt').destructive).toBeUndefined();
    expect(inferSignalsFromTask('aws s3 rm s3://b/x\nthen run the tests with --recursive').destructive).toBeUndefined();
    // A hard-wrapped command: the old regex let the space between `s3` and `rm` be a line break.
    expect(inferSignalsFromTask('run aws s3\nrm s3://prod-exports/2023 --recursive').destructive).toBe(true);
  });
});

// The re-review of the review fix (2a9c462), measured against 52d010b and 418c1e9.
describe('A44 re-review — the token and count rules, measured again', () => {
  // The first exclusion list had no word boundary: `admin` ends in `min`, `account` and `discount` in
  // `count`, `enum` in `num`, `breach` in `each` — "rotate ADMIN_TOKEN in all files" routed LOW / grok.
  it.each([
    'rotate ADMIN_TOKEN in all files', 'rotate the SERVICE_ACCOUNT_TOKEN in all files', 'rotate the admin token in all files',
    'accountToken is logged in plain text', 'the discount token is forgeable', 'the enum token leaks', 'breach token',
    // A plural token is a credential unless it counts: the owner list missed these (re-review).
    'rotate all tokens in 12 files', 'revoke the admin tokens', 'user tokens are stored in plain text', 'bot tokens leaked',
    'deploy tokens for the CI', 'reset tokens never expire', 'verification tokens are guessable',
  ])('a credential sense is a security task: %s', (task) => {
    expect(inferSignalsFromTask(task).security).toBe(true);
  });
  it.each([
    'reduce max tokens for the summarizer prompt', 'count tokens in the CSV importer', 'update the design tokens in 12 component files',
    'raise max_tokens in the client config', 'maxTokens is too low', 'the token count is wrong in the usage view',
    'refactor the tokenizer across 40 files', 'log input tokens and output tokens', 'predict the next token', 'num_tokens in the config',
  ])('an LLM or design sense still is not: %s', (task) => {
    expect(inferSignalsFromTask(task).security).toBeUndefined();
  });

  // A count right after another number: the forward regex had to refuse any start after digit+separator
  // to stay linear, and lost these (re-review). The count is now read backwards from `file`.
  it.each(['in 2024 10 files', 'issue #4521\n12 files', 'rev 7 12 files', 'Q3 2 files', 'PR 12 1,000 files', 'touch 2024 100 files',
    'v1.2 100 files'])(
    'a count after another number is still a count: %s', (task) => {
      expect(inferSignalsFromTask(task).bulk).toBe(true);
    });
  it.each(['1.5 files', 'fix 007 files', '0 files', 'v1 file', 'the 1 file', 'page 2, 2.5 files', '10:30 3,4 files'])('not a count of 2 or more: %s', (task) => {
    expect(inferSignalsFromTask(task).bulk).toBeUndefined();
  });
  it('a long run of numbers before `files` stays linear', () => {
    for (const input of ['1 '.repeat(64_000) + 'files', '123 '.repeat(32_000) + 'files', '1,'.repeat(64_000) + '000 files', 'files '.repeat(20_000)]) {
      const t0 = performance.now();
      inferSignalsFromTask(input);
      expect(performance.now() - t0).toBeLessThan(250);
    }
  });
});

// Round 3 of the pre-merge review (2026-09-25), measured on the re-review fix (09383ab).
describe('A44 round 3 — the token rule and the count reader, measured a third time', () => {
  it.each([
    // An owner word says whose token it is, whatever follows: the suffix exclusions (`limit`, `usage`,
    // `count`) had no word end, and the round-2 rule let them overrule the owner — routed LOW / grok.
    'make refresh tokens limited to one use in all files', 'access tokens limited to one hour in all files',
    'session tokens usage must be audited in all files', 'api tokens count against the per-user quota in all files',
    // Any letter after `token` used to exclude it: every camelCase credential identifier went LOW / grok.
    'rename accessTokenExpiry in 12 files', 'rename TokenValidator in 12 files', 'rename tokenStore in 12 files',
    // An exclusion does not reach across a line break.
    'Fix the design\nToken rotation must happen every 24h in all files', '- rotate the bot token\n- usage docs in all files',
    // `each` is not a counting word here: it was, and these routed MEDIUM.
    'validate each token signature before accepting it', 'revoke each token issued to the compromised GitHub service account',
    // A lifetime after `token` is a credential's, whatever counts before it (with a bulk word, LOW / grok in
    // v0.2.35 and in the round-1 and round-2 fixes; the code before the review, 566ba73, routed it HIGH).
    'set MAX_TOKEN_AGE to 900 in all files', 'enforce a max token age of 15 minutes', 'lower max_token_ttl in all files',
    // An owner word on the line before still says whose tokens they are.
    'rotate the personal\ntokens limit in all files',
  ])('a credential sense is a security task: %s', (task) => {
    expect(inferSignalsFromTask(task).security).toBe(true);
  });
  // LLM parameters written as identifiers go to Claude — the fail-closed side. Round 3 excluded them (`_` and
  // a capital as a word start, a camelCase split, `n`/`total`/`reasoning` as counting words), and round 4
  // measured what that cost: `security_context_token`, an escaped `\nToken` and `tOKEN` routed LOW / grok.
  it.each([
    'raise max_completion_tokens in 12 files', 'raise max_output_tokens in 12 files', 'raise maxOutputTokens in 12 files',
    'raise DEFAULT_MAX_TOKENS in 12 files', 'raise n_tokens in 12 files', 'raise total_tokens in 12 files',
  ])('an LLM parameter written as an identifier is routed as security: %s', (task) => {
    expect(inferSignalsFromTask(task).security).toBe(true);
  });

  // A count after a refused number, with thousands of its own: only the last group was tried.
  it.each(['python 3.12 291.213 files', 'v1.2 100.000 files', 'rev 3,14 159,265 files'])('a middle thousands group is a count: %s', (task) => {
    expect(inferSignalsFromTask(task).bulk).toBe(true);
  });

  // The linear test above cannot fail: without `--recursive` the rule returns at the first `rm`. With it
  // after every line, the version without the cached searches took 748 ms at 528,000 chars (7.7 ms fixed).
  it('"s3 rm" on 88,000 lines, then `--recursive`, stays linear', () => {
    const t0 = performance.now();
    inferSignalsFromTask('s3 rm\n'.repeat(88_000) + '--recursive');
    expect(performance.now() - t0).toBeLessThan(250);
  });
});

// Round 4 of the pre-merge review (2026-09-26), measured on the round-3 fix (2d5ad95).
describe('A44 round 4 — what the round-3 token rule lost, and the tests that could not fail', () => {
  it.each([
    // An escaped line break before `Token` was split into the counting word `n`: LOW / grok.
    'Fix the header builder in all files: \\r\\nToken: + apiKey',
    // A counting word INSIDE a credential identifier is part of the name, not a count.
    'rename security_context_token in 12 files', 'rename SecurityContextToken in 12 files',
    'rename GITHUB_INPUT_TOKEN in all files', 'rename WS_SECURITY_CONTEXT_TOKEN in all files',
    // Odd casing split `tOKEN` into `t oken`.
    'rotate the tOKEN in all files',
    // Grok's round-4 pass: `tokenis…` was skipped as `tokenise`, and `TokenIssuer` mints credentials.
    'Refactor TokenIssuer so the raw value never appears in logs',
    // Each pinned without an owner word, which would pass on its own: a suffix exclusion is a whole word
    // (`limited` is not `limit`), and every lifetime word beats a counting word.
    'rotate the bot tokens limited to one use in all files',
    'set the max token lifetime to 15 minutes', 'raise max_token_expiry in all files', 'cap the max token expiration',
  ])('a credential sense is a security task: %s', (task) => {
    expect(inferSignalsFromTask(task).security).toBe(true);
  });

  // A number glued to a name is part of it (`mp3`, `utf8`, `sha256`): these were bulk — LOW / grok — in
  // every version.
  it.each(['debug why the importer crashes on mp3 files', 'convert the utf8 files', 'verify the sha256 files'])(
    'a number inside a name is not a count: %s', (task) => {
      expect(inferSignalsFromTask(task).bulk).toBeUndefined();
    });
  // No bulk verb in either, so only the count can make them bulk (`rename` alone is bulk — round 5).
  it.each(['update the mp3 tags in 12 files', 'the files in 3 dirs: 12 files'])('a count after such a name still is: %s', (task) => {
    expect(inferSignalsFromTask(task).bulk).toBe(true);
  });

  // The other cached search, the line end: without it `s3 rm` on one line took 776 ms at 528,000 chars
  // (10 ms fixed), and every test above passed.
  it('"s3 rm " on one line, then `--recursive` on the next, stays linear', () => {
    const t0 = performance.now();
    inferSignalsFromTask('s3 rm '.repeat(88_000) + '\n--recursive');
    expect(performance.now() - t0).toBeLessThan(250);
  });
});

// Round 5 of the pre-merge review (2026-09-26), measured on the round-4 fix (07ecb41).
describe('A44 round 5 — the camelCase credential names a lowercase reading lost', () => {
  it.each([
    // Round 4 read the task lowercased only, and three camelCase classes the round-3 split had routed as
    // security went LOW / grok — 578 of the review's 6,650 identifiers: an owner word before a glued counted
    // word, a glued `Is…` read as `tokenise…`, a lifetime word glued to its unit.
    'rename accessTokenCount in 12 files', 'update the userAccessTokenCount metric in all files',
    'refactor refreshTokenLimit handling in 20 files', 'rename api_tokenCount in all files',
    'fix the idTokenIsExpired check in all files', 'rename TokenIsMissing in 12 files', 'update botTokenIsActive in all files',
    'rename MaxTokenAgeSeconds in 12 files', 'set nextTokenExpiresAt in all files', 'update minTokenTtlMs in all files',
    // A counting word joined by `-` is part of the name, as with `_` (nothing pinned the `-`).
    'rename github-input-token in all files', 'rename the security-context-token header in 12 files',
    // A capital after `token` starts a new word — a capital S is not a plural (the review's random
    // differential shrank its one remaining loss to this).
    'rename r_TokenS WINDOWS.session in all files',
    // A digit before a capital is a word start too, and the owner can start right there (round 6: dropping
    // either passed every test).
    'rename s3AccessTokenCount in all files', 'rename v2RefreshTokenLimit in all files',
  ])('a credential sense is a security task: %s', (task) => {
    expect(inferSignalsFromTask(task).security).toBe(true);
  });

  // Case marks a word start only where it ADDS a credential sense: a counting word is still read whole, and a
  // split or counted word still excludes. `tokenism`, `tokenistic`: the `m` and `t` of the split words.
  it.each([
    'raise maxTokens in all files', 'update tokenCount in all files', 'fix the tokenizer in all files',
    'rename tokenizeInput in all files', 'the TokenizerService crashes in 12 files', 'raise max_tokens in all files',
    'the tokenism debate in 12 files', 'rename the tokenistic helper in 12 files',
  ])('a counting or split sense is not: %s', (task) => {
    expect(inferSignalsFromTask(task).security).toBeUndefined();
  });

  // An `_` thousands separator is part of a name, as a letter is (nothing pinned the `_`).
  it.each(['sync the 7_926_248 files', 'update v_12 files'])('a number after `_` is not a count: %s', (task) => {
    expect(inferSignalsFromTask(task).bulk).toBeUndefined();
  });
});
