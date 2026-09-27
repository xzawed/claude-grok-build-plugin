import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { buildHistoryEntry, appendHistory, recordDelegation, redactSecrets, HISTORY_DIR_MODE, HISTORY_FILE_MODE } from '../src/history.js';
import type { DelegateInput, DelegateResult } from '../src/types.js';

const input: DelegateInput = { prompt: 'add a hello test', cwd: '/abs/proj' };
const meta = { ts: '2026-07-13T00:00:00.000Z', durationMs: 1234 };
const completed: DelegateResult = {
  status: 'completed', mode: 'subscription', billing: 'subscription',
  summary: 'Created hi.ts', filesChanged: ['src/a.ts'],
};

describe('buildHistoryEntry', () => {
  it('carries status/mode/billing/cwd and core fields', () => {
    const e = buildHistoryEntry(input, completed, meta);
    expect(e).toMatchObject({
      ts: meta.ts, mode: 'subscription', billing: 'subscription', status: 'completed',
      cwd: '/abs/proj', filesChanged: ['src/a.ts'], filesCount: 1, filesTruncated: false, durationMs: 1234,
    });
    expect(e.promptPreview).toBe('add a hello test');
    expect(e.summaryPreview).toBe('Created hi.ts');
  });
  it('collapses whitespace and truncates prompt/summary to 200 chars + ellipsis', () => {
    const long = 'x'.repeat(250);
    const e = buildHistoryEntry({ prompt: '  a\n\nb  ', cwd: '/p' }, { ...completed, summary: long }, meta);
    expect(e.promptPreview).toBe('a b');
    expect(e.summaryPreview!.length).toBe(201);
    expect(e.summaryPreview!.endsWith('…')).toBe(true);
  });
  it('omits summaryPreview when there is no summary and defaults empty files', () => {
    const e = buildHistoryEntry(input, { status: 'timeout', mode: 'api', billing: 'metered_api' }, meta);
    expect(e.summaryPreview).toBeUndefined();
    expect(e.filesChanged).toEqual([]);
    expect(e.filesCount).toBe(0);
  });
  it('caps filesChanged at 100 while keeping the true count', () => {
    const many = Array.from({ length: 150 }, (_, i) => `f${i}.ts`);
    const e = buildHistoryEntry(input, { ...completed, filesChanged: many }, meta);
    expect(e.filesChanged.length).toBe(100);
    expect(e.filesTruncated).toBe(true);
    expect(e.filesCount).toBe(150);
  });
  it('never includes any credential/env/stderr field', () => {
    const e = buildHistoryEntry(input, { ...completed, rawStderrTail: 'XAI_API_KEY=sk-secret' }, meta);
    const json = JSON.stringify(e);
    expect(json).not.toContain('sk-secret');
    expect(json).not.toContain('XAI_API_KEY');
    expect(json).not.toContain('rawStderrTail');
  });
  it('redacts API-key assignments pasted into the prompt or summary', () => {
    const e = buildHistoryEntry(
      { prompt: 'set XAI_API_KEY=sk-live-secret and GROK_CODE_XAI_API_KEY: tok-xyz then continue', cwd: '/p' },
      { ...completed, summary: 'do not store XAI_API_KEY=sk-live-secret' },
      meta,
    );
    const json = JSON.stringify(e);
    expect(json).not.toContain('sk-live-secret');
    expect(json).not.toContain('tok-xyz');
    expect(e.promptPreview).toMatch(/XAI_API_KEY=<redacted>/);
    // The separator is preserved now, so a `:` assignment stays a `:` assignment — rewriting it
    // to `=` used to turn a redacted JSON blob into something that no longer parsed.
    expect(e.promptPreview).toMatch(/GROK_CODE_XAI_API_KEY: <redacted>/);
    expect(e.summaryPreview).toMatch(/XAI_API_KEY=<redacted>/);
  });
  it('redacts quoted-key assignments (.env / JSON / YAML shapes)', () => {
    const e = buildHistoryEntry(
      {
        prompt:
          'export "XAI_API_KEY"="xai-liveSECRET0123456789abcdef" and paste ' +
          '{"env": {"GROK_CODE_XAI_API_KEY": "xai-jsonSECRET0123456789abc"}} plus ' +
          "'XAI_API_KEY': 'xai-yamlSECRET0123456789abc'",
        cwd: '/p',
      },
      completed,
      meta,
    );
    const json = JSON.stringify(e);
    expect(json).not.toContain('liveSECRET');
    expect(json).not.toContain('jsonSECRET');
    expect(json).not.toContain('yamlSECRET');
  });
  it('redacts a bare xai- key token pasted without a variable name', () => {
    const e = buildHistoryEntry(
      { prompt: 'use my key xai-bareSECRET0123456789abcdefghij for the run', cwd: '/p' },
      { ...completed, summary: 'stored xai-bareSECRET0123456789abcdefghij nowhere' },
      meta,
    );
    const json = JSON.stringify(e);
    expect(json).not.toContain('bareSECRET');
  });
  it('leaves ordinary prose and short xai- words untouched', () => {
    const e = buildHistoryEntry(
      { prompt: 'read the xai-cli docs and mention XAI_API_KEY in the README', cwd: '/p' },
      completed,
      meta,
    );
    expect(e.promptPreview).toContain('xai-cli');
    expect(e.promptPreview).toContain('XAI_API_KEY');
  });
  it('carries worktreePath (from result) and sandbox (from input) when present, omits when absent', () => {
    const withIso = buildHistoryEntry(
      { prompt: 'x', cwd: '/p', sandbox: 'readonly' },
      { ...completed, worktreePath: '/wt/path' },
      meta,
    );
    expect(withIso.worktreePath).toBe('/wt/path');
    expect(withIso.sandbox).toBe('readonly');
    const plain = buildHistoryEntry(input, completed, meta);
    expect(plain.worktreePath).toBeUndefined();
    expect(plain.sandbox).toBeUndefined();
  });
  it('marks plan runs with plan:true, omits otherwise', () => {
    const p = buildHistoryEntry({ prompt: 'x', cwd: '/p', plan: true }, completed, meta);
    expect(p.plan).toBe(true);
    expect(buildHistoryEntry(input, completed, meta).plan).toBeUndefined();
  });
  it('marks check runs with check:true, omits otherwise', () => {
    const c = buildHistoryEntry({ prompt: 'x', cwd: '/p', check: true }, completed, meta);
    expect(c.check).toBe(true);
    expect(buildHistoryEntry(input, completed, meta).check).toBeUndefined();
  });
  it('carries sessionId from result when present, omits otherwise', () => {
    const withSid = buildHistoryEntry(input, { ...completed, sessionId: 'sess-abc-123' }, meta);
    expect(withSid.sessionId).toBe('sess-abc-123');
    expect(buildHistoryEntry(input, completed, meta).sessionId).toBeUndefined();
  });
});

describe('appendHistory + recordDelegation', () => {
  it('writes one JSON line + newline via the injected writer', () => {
    const writes: Array<[string, string]> = [];
    appendHistory(buildHistoryEntry(input, completed, meta), {
      path: '/x/history.jsonl', write: (p, l) => writes.push([p, l]),
    });
    expect(writes.length).toBe(1);
    expect(writes[0][0]).toBe('/x/history.jsonl');
    expect(writes[0][1].endsWith('\n')).toBe(true);
    expect(JSON.parse(writes[0][1])).toMatchObject({ status: 'completed', cwd: '/abs/proj' });
  });
  it('recordDelegation swallows writer errors (never throws)', () => {
    expect(() => recordDelegation(input, completed, meta, {
      write: () => { throw new Error('disk full'); },
    })).not.toThrow();
  });
  it('appends across calls (does not overwrite)', () => {
    const lines: string[] = [];
    const deps = { path: '/x', write: (_p: string, l: string) => { lines.push(l); } };
    recordDelegation(input, completed, meta, deps);
    recordDelegation(input, completed, meta, deps);
    expect(lines.length).toBe(2);
  });
  it('defaultWrite creates the dir and appends a real file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grok-hist-'));
    const path = join(dir, 'nested', 'history.jsonl');
    appendHistory(buildHistoryEntry(input, completed, meta), { path });
    appendHistory(buildHistoryEntry(input, completed, meta), { path });
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).status).toBe('completed');
  });
});

describe('history file permissions', () => {
  it('creates the dir and file owner-only, matching the 0600 patch file in worktree.ts', () => {
    const base = mkdtempSync(join(tmpdir(), 'grok-perm-'));
    const path = join(base, 'nested', 'history.jsonl');
    appendHistory(buildHistoryEntry(input, completed, meta), { path });
    expect(existsSync(path)).toBe(true);

    // The file holds 200-char prompt previews and absolute cwd paths — the user's project
    // text. The defaults (0644 in a 0755 dir) make that readable by every local account.
    expect(HISTORY_DIR_MODE).toBe(0o700);
    expect(HISTORY_FILE_MODE).toBe(0o600);

    if (process.platform !== 'win32') {
      expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
  });
});

// ── Audit 2, 2026-09-03. Measured: only xAI billing keys were masked, so a Bearer JWT, an AWS
// secret, a GitHub PAT and a bare `password:` line were written verbatim to
// ~/.grok-build/history.jsonl AND replayed to Claude through grok_build_usage.recent[] and
// grok_build_status.lastSession. CLAUDE.md principle #4 and the logging design spec both say
// "no credentials, ever" — the code was narrower than the promise.
describe('redactSecrets beyond xAI keys', () => {
  const cases: [string, string, string][] = [
    ['bearer token', 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.aaaaaaaaaaaaaaaaaaaa', 'eyJ'],
    ['standalone jwt', 'use eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.aaaaaaaaaaaaaaaaaaaa for auth', 'eyJhbGciOiJIUzI1NiJ9.eyJ'],
    ['aws secret assignment', 'AWS_SECRET_ACCESS_KEY=NOTAREALKEY0000EXAMPLEONLY0000NOTAREAL00', 'NOTAREALKEY0000'],
    ['aws access key id', 'creds AKIAXXXXXXXXEXAMPLE0 here', 'AKIAXXXXXXXXEXAMPLE0'],
    ['github pat', 'token ghp_EXAMPLEONLYnotarealtokenEXAMPLEONLY00', 'ghp_EXAMPLEONLY'],
    ['github fine-grained pat', 'github_pat_11EXAMPLEONLY0notarealtokenEXAMPLEONLY0notarealtoken00', 'github_pat_11EXAMPLEONLY0'],
    ['openai style key', 'OPENAI key sk-EXAMPLEONLYnotarealkey000000000000', 'sk-EXAMPLEONLY'],
    ['slack token', 'xoxb-EXAMPLE0NOTREAL0-EXAMPLE0NOTREAL0-EXAMPLEONLYNOTAREALTOKEN', 'EXAMPLEONLYNOTAREALTOKEN'],
    ['generic password assignment', 'password: hunter2correcthorse', 'hunter2correcthorse'],
    ['generic secret assignment', 'client_secret = s3cr3tvaluegoeshere', 's3cr3tvaluegoeshere'],
    ['private key block', '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----', 'MIIEow'],
  ];
  for (const [name, input, secret] of cases) {
    it(`redacts a ${name}`, () => {
      const out = redactSecrets(input);
      expect(out, name).not.toContain(secret);
      expect(out, name).toContain('<redacted>');
    });
  }

  it('still redacts the xAI billing keys it always did', () => {
    expect(redactSecrets('XAI_API_KEY=xai-abcdefghijklmnopqrstuvwxyz012345')).toBe('XAI_API_KEY=<redacted>');
    expect(redactSecrets('paste xai-abcdefghijklmnopqrstuvwxyz012345 here')).toContain('<redacted>');
  });

});

// Grok's adversarial pass ran 45 realistic delegate prompts through the first version of the
// broadened redaction and found 19 of them mangled — matching on a credential-ish NAME plus any
// 8+ character value turns type annotations, YAML keys and GitHub Actions expressions into
// `name=<redacted>`. A history that eats ordinary task descriptions is worse than no history.
// Every string below came back altered then and must survive untouched now.
describe('redactSecrets leaves realistic engineering prose intact', () => {
  const prose = [
    'Fix the token parser in the lexer',
    'The api_key field is missing from the response schema',
    'Rename every password reset handler',
    'Add secret scanning to CI',
    'Refactor bearer handling in middleware',
    'Set DATABASE_URL in the compose file to point at the test container',
    'Document that access_token expires after 3600 seconds',
    'The private key path is configurable',
    'Migrate from sk-learn to scikit-learn imports',
    'Handle the case where api_key: undefined in the payload',
    'Set api_key: required in the OpenAPI spec',
    'Document DATABASE_URL: string in the env table',
    'Implement Bearer authentication-middleware for the public API',
    'Bump the sk-learn-model-selection extras to match sklearn 1.5',
    'Configure private_key: /etc/ssl/private/app.pem for the service',
    'Leave password: unchanged in the user migration',
    'Mark secret: optional on the signup form',
    'Replace client_secret: placeholder in the oauth template',
    'Set access_token: expires_in mapping in the client',
    'The apikey: generated flag should stay false',
    'The x-api-key: required header must be documented',
    'OPENAI_API_KEY: string belongs in the env schema, not a sample value',
    'password: required true in the collapsed YAML user model',
    'Add secret: scanning-step documentation to CONTRIBUTING',
    'Document the xai-cli wrapper and its flags',
  ];
  for (const t of prose) {
    it(`keeps: ${t.slice(0, 46)}`, () => {
      expect(redactSecrets(t)).toBe(t);
    });
  }
});

describe('redactSecrets preserves the surrounding syntax when it does fire', () => {
  // The first version rewrote `:` to `=` and stripped quotes, so a redacted JSON blob stopped
  // being JSON. Separator and quoting are now carried through.
  it('keeps JSON shape', () => {
    const out = redactSecrets('{"OPENAI_API_KEY": "sk-EXAMPLEONLYnotarealkey000000000000", "model": "gpt"}');
    expect(out).toBe('{"OPENAI_API_KEY": "<redacted>", "model": "gpt"}');
  });
  it('keeps a YAML colon', () => {
    expect(redactSecrets('password: hunter2correcthorse')).toBe('password: <redacted>');
  });
  it('keeps a bare equals', () => {
    expect(redactSecrets('XAI_API_KEY=xai-abcdefghijklmnopqrstuvwxyz012345')).toBe('XAI_API_KEY=<redacted>');
  });
});

// A6 (docs/10, MEASURED 2026-09-05/06): every shape below was written VERBATIM into
// ~/.grok-build/history.jsonl and replayed to Claude through usage.recent[] and
// status.lastSession on every dashboard call. Measured against the shipped redactor: 8/8 leaked.
//
// The audit's sharper point: this rule had NEVER fired in production — zero `<redacted>` in 1779
// real rows — so the whole behaviour claim was untested by real traffic. These are the shapes
// people actually paste into a task description.
//
// Assembled at runtime, never written as one literal: GitHub secret scanning reads a
// scanner-shaped fixture as a live credential. Push protection refused the push for the two API
// keys (measured), and the MongoDB URI — left as a plain literal at the time, the one shape here
// that matches a partner pattern — opened alert #1 on the public repo, which is why it is split
// too now. A fixture that trips secret scanning is a bad fixture even when it is fake.
const STRIPE = 'sk_' + 'live_' + '51QxAbCdEfGhIjKlMnOpQrStU';
const GOOGLE = 'AIza' + 'SyD-1a2b3c4d5e6f7g8h9i0jKlMnOpQrStU';
// `Hunter2` doubled, because the redactor ignores opaque values under 12 chars (history.ts).
const MONGO_PW = 'Hunter2' + 'Hunter2';
const MONGO_URI = 'mongo' + 'db+srv://root:' + MONGO_PW + '@cluster0.mongodb.net';

describe('A6 — the shapes that leaked', () => {
  const leaked: [string, string, string][] = [
    ['DATABASE_URL assignment', 'set DATABASE_URL=postgres://app:s3cretPw99@db.internal:5432/prod', 's3cretPw99'],
    ['DB_URL assignment', 'DB_URL=mysql://admin:P4ssw0rd123@10.0.0.5/app', 'P4ssw0rd123'],
    ['CONNECTION_STRING', 'CONNECTION_STRING: ' + MONGO_URI, MONGO_PW],
    ['bare url credentials', 'clone https://user:ghp_realtokenvalue99@github.com/org/repo.git', 'ghp_realtokenvalue99'],
    ['basic auth header', 'add header Authorization: Basic YWRtaW46c3VwZXJzZWNyZXQxMjM=', 'YWRtaW46c3VwZXJzZWNyZXQxMjM'],
    ['stripe live key', 'use ' + STRIPE + ' as the key', STRIPE],
    ['google api key', 'GOOGLE key ' + GOOGLE, GOOGLE],
  ];

  for (const [name, input, secret] of leaked) {
    it(`redacts ${name}`, () => {
      const out = redactSecrets(input);
      expect(out, name).not.toContain(secret);
      expect(out, 'something must be marked, not just dropped').toContain('<redacted>');
    });
  }

  // FOUND BY GROK reviewing this fix: the username part was `+`, so a URL with NO username did
  // not match — and `redis://:password@host` is the standard Redis URL form, not an edge case.
  it('redacts a URL password when there is no username at all', () => {
    const out = redactSecrets('connect with redis://:justapasswordnouser@cache:6379');
    expect(out).not.toContain('justapasswordnouser');
    expect(out).toContain('cache:6379');
  });
  it('redacts a PEM block with no closing marker', () => {
    // A 200-char preview truncates mid-key routinely, so requiring `-----END-----` meant the
    // TRUNCATED case — the common one — was the case that leaked.
    const pem = ['key is -----BEGIN RSA PRIVATE KEY-----','MIIEowIBAAKCAQEAx7Qk9vZ1mQ'].join(String.fromCharCode(10));
    const out = redactSecrets(pem);
    expect(out).not.toContain('MIIEowIBAAKCAQEAx7Qk9vZ1mQ');
    expect(out).toContain('<redacted>');
  });

  it('keeps the host so the row still says something', () => {
    // Redaction that erases the whole line makes the history useless and gets turned off.
    const out = redactSecrets('clone https://user:ghp_realtokenvalue99@github.com/org/repo.git');
    expect(out).toContain('github.com/org/repo.git');
  });
});

describe('A6 — and the prose that must survive it', () => {
  const prose = [
    'document how DATABASE_URL is configured in the README',
    'the Authorization header uses Basic auth in staging',
    'DATABASE_URL: string belongs in the env schema',
    'CONNECTION_STRING is required but unset in CI',
    'add a sk_live check to the billing test fixtures',
    'rename the AIza prefix constant in the validator',
    'parse postgres:// urls in the config loader',
    'the private key block parser needs a test',
  ];
  for (const line of prose) {
    it(`leaves alone: ${line}`, () => {
      expect(redactSecrets(line)).toBe(line);
    });
  }
});

describe('npm tokens are a token shape too (A22)', () => {
  // MEASURED 2026-09-06, redactSecrets re-run against a corpus it was never tuned on:
  // 16 of 18 secret shapes masked, 0 of 12 ordinary sentences mangled — the over-correction
  // Grok caught in an earlier round is gone. `npm_...` was the one real survivor.
  // (The other apparent survivor, an `ssh-rsa AAAA…` public key, was a bad test case: a public
  // key is not a secret, and redacting it would be the over-correction all over again.)
  //
  // Principle #4 already says masking is mitigation, not a guarantee, so this is a coverage
  // gap rather than a broken contract. It is closed the same way A6 closed its own.
  it('redacts an npm automation token', () => {
    const npmToken = 'npm_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
    expect(redactSecrets(npmToken)).toBe('<redacted>');
  });

  it('redacts it inside the .npmrc line people actually paste', () => {
    const line = '//registry.npmjs.org/:_authToken=npm_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
    const out = redactSecrets(line);
    expect(out).not.toContain('A1b2C3d4');
    expect(out).toContain('registry.npmjs.org'); // the context that makes the row useful survives
  });

  // The over-correction guard. `npm_` is a common identifier prefix in ordinary text, so the
  // length floor is what keeps prose intact — exactly the failure Grok found the first time.
  it('leaves npm-prefixed prose and short identifiers alone', () => {
    for (const s of [
      'run npm_config_registry before the build',
      'the npm_package_version env var is set by npm itself',
      'add a fixture named npm_token_parser_test',
      'npm_lifecycle_event tells you which script is running',
    ]) {
      expect(redactSecrets(s), s).toBe(s);
    }
  });

  // A public key is not a secret — pinned so nobody "fixes" it later.
  it('does not redact an ssh PUBLIC key', () => {
    const pub = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQ deploy@host';
    expect(redactSecrets(pub)).toBe(pub);
  });
});

// A37 (docs/10, MEASURED 2026-09-25 on the committed tree): the assignment rule matched a credential
// word only at a `\b`, and `_` is a word character — so the most common .env shape, a PREFIXED name,
// never matched. 9 of 9 lines below were written verbatim into history.jsonl and replayed to Claude by
// grok_build_usage / grok_build_status. `SECRET_KEY` was not in the list at all.
// Values are assembled at runtime where they look like a provider's token (see the A6 note above).
const V = 'hU7xK2pQ9zL4mN8r';
describe('A37 — prefixed and compound credential names', () => {
  const measured = [
    `DB_PASSWORD=${V}`, `POSTGRES_PASSWORD=${V}`, `MYSQL_ROOT_PASSWORD: ${V}`, `JWT_SECRET=${V}`,
    `SECRET_KEY=${V}`, `GOOGLE_CLIENT_SECRET=${V}`, `TWILIO_AUTH_TOKEN=${V}`, `SENDGRID_API_KEY=${V}`,
    `"DB_PASSWORD": "${V}"`,
  ];
  it.each(measured)('the audit payload: %s', (line) => {
    const out = redactSecrets(line);
    expect(out).not.toContain(V);
    expect(out).toContain('<redacted>');
  });

  it('keeps the name, separator and quoting so the row still reads', () => {
    expect(redactSecrets(`DB_PASSWORD=${V}`)).toBe('DB_PASSWORD=<redacted>');
    expect(redactSecrets(`MYSQL_ROOT_PASSWORD: ${V}`)).toBe('MYSQL_ROOT_PASSWORD: <redacted>');
    expect(redactSecrets(`{"db_password": "${V}", "db_host": "db.internal"}`))
      .toBe('{"db_password": "<redacted>", "db_host": "db.internal"}');
  });

  // The other spellings the same name takes in the files people paste: camelCase code, dotted
  // properties, kebab flags, `.npmrc`, PowerShell and docker.
  it.each([
    `dbPassword: '${V}'`, `const apiKey = "${V}"`, `spring.datasource.password=${V}`,
    `--db-password=${V}`, `//registry.npmjs.org/:_authToken=${V}`, `$env:DB_PASSWORD="${V}"`,
    `docker run -e REDIS_PASSWORD=${V} redis:7`, `export SMTP_PASS=${V}`, `JWT_SIGNING_KEY=${V}`,
    `set DB_PASSWORD=${V} && npm start`,
  ])('%s', (line) => {
    const out = redactSecrets(line);
    expect(out).not.toContain(V);
    expect(out).toContain('<redacted>');
  });

  // An env-style NAME is itself the evidence (nobody writes DB_PASSWORD= casually), so a short or
  // plain value is still masked there — unlike a bare `password:` in prose, which needs an opaque value.
  it('an env-style name does not need an opaque value', () => {
    expect(redactSecrets('DB_PASSWORD=hunter2')).toBe('DB_PASSWORD=<redacted>');
    expect(redactSecrets('password: hunter2')).toBe('password: hunter2');
  });
});

// Written by Grok (2026-09-25) without seeing this redactor: 15 lines a user would paste that carry a
// secret, 15 that only mention one. Two were left out on purpose: a Slack webhook path (a shape this
// redactor does not cover — release note, "하지 않는 것") and a URL format string (see the last test).
describe('A37 — an independent corpus (Grok)', () => {
  const secrets: [string, string][] = [
    ['DB_PASSWORD=K7mQ2pLx9nVa4w', 'K7mQ2pLx9nVa4w'],
    ['STRIPE_SECRET_KEY=' + 'sk_' + 'test_' + '4Hn8pQ2mLx9vR6tY', '4Hn8pQ2mLx9vR6tY'],
    ['export AWS_SECRET_ACCESS_KEY=' + 'wJalrXUtnFEMI7' + 'EXAMPLEKEY', 'wJalrXUtnFEMI7'],
    ['MYSQL_ROOT_PASSWORD: pQ9mL2xR7nVa4kT8', 'pQ9mL2xR7nVa4kT8'],
    ['"db_password": "nR4kP8mQ2vLx7tY9"', 'nR4kP8mQ2vLx7tY9'],
    ['psql --password=H3kN9pQx2mLv8rT4 --host db.internal', 'H3kN9pQx2mLv8rT4'],
    ['postgres://appuser:s3cretK9mP2xL7q@db.internal:5432/app', 's3cretK9mP2xL7q'],
    ['//registry.npmjs.org/:_authToken=' + 'npm_' + '8kP2mQ9xL4vR7nT1aB3c', '8kP2mQ9xL4vR7nT1aB3c'],
    ['password = ' + 'pypi-' + 'Ag3kN8mQ2xL7vR4tY9', 'Ag3kN8mQ2xL7vR4tY9'],
    ['docker run -e REDIS_PASSWORD=mK8pQ2nL9vXa4rT7 redis:7', 'mK8pQ2nL9vXa4rT7'],
    ['GITHUB_TOKEN=' + 'ghp_' + '91kLmN2pQxR8vT4yA7bC', '91kLmN2pQxR8vT4yA7bC'],
    ['OPENAI_API_KEY=' + 'sk-' + 'proj-' + '8Qm2nL4pX9vR7tK3aB', '8Qm2nL4pX9vR7tK3aB'],
    ['Authorization: Bearer ' + 'eyJ' + 'hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' + '.payload.sigK2m', 'hbGciOiJIUzI1NiIs'],
    ['SENDGRID_API_KEY=' + 'SG.' + 'k8Pm2nQ4xL9vR7tY' + '.aB3cD5eF6gH', 'k8Pm2nQ4xL9vR7tY'],
  ];
  it.each(secrets)('masks: %s', (line, secret) => {
    expect(redactSecrets(line)).not.toContain(secret);
  });

  const prose = [
    'Set DB_PASSWORD in your local .env before starting the API.',
    'db_password: str | None = Field(default=None)',
    'STRIPE_SECRET_KEY=<your_stripe_secret_key>',
    'Rename AWS_SECRET_ACCESS_KEY to AWS_SECRET_ACCESS_KEY_OLD in the chart.',
    'Which env var holds the database password in staging?',
    '2026-04-02T11:03:11Z auth failed password=*** user=app',
    'const key = process.env.OPENAI_API_KEY',
    'MYSQL_ROOT_PASSWORD is required; never commit its value.',
    'password: ${{ secrets.DB_PASSWORD }}',
    'export AWS_SECRET_ACCESS_KEY',
    '// never log STRIPE_SECRET_KEY or the webhook signing secret',
    'if (!config.db_password) throw new Error("db_password missing")',
    'The --password flag must not appear in shell history.',
    'npm token create writes _authToken into ~/.npmrc',
  ];
  it.each(prose)('leaves alone: %s', (line) => {
    expect(redactSecrets(line)).toBe(line);
  });

  // The env-style rule must not eat settings or references that share a credential word.
  it.each([
    'MAX_TOKEN=4096', 'FIRST_PASS=1', 'PWD=/home/dev/project', 'DB_PASSWORD=${DB_PASSWORD}',
    'DB_PASSWORD=$DB_PASSWORD', 'API_KEY=%API_KEY%', 'password_min_length: 12', 'token_type: bearer',
    'sort_key: created_at', 'Content-Type: application/json', 'SECRET_KEY=changeme',
  ])('leaves alone: %s', (line) => {
    expect(redactSecrets(line)).toBe(line);
  });

  // Grok's second, adversarial pass was given these rules and asked where they go wrong. Of its 20
  // lines all 20 behaved as it traced, and 18 behaved the same on the pre-A37 redactor — existing
  // limits (a passphrase with spaces, a <12-char password in prose, `Token`/`Bot` auth schemes, Slack
  // webhook paths, `rk_live_`/`glpat-` shapes; `DATABASE_URL`/PEM over-masking by design). Two of those
  // existing leaks, a `passphrase=` and Azure's `AccountKey=`, fit this rule's frame, so they are fixed and
  // pinned here. The other two lines were over-masks this rule made (release note, "하지 않는 것").
  it('masks a passphrase', () => {
    expect(redactSecrets('passphrase=Tr0ub4dor-and-3')).toBe('passphrase=<redacted>');
  });
  it('masks an Azure AccountKey and keeps the rest of the connection string', () => {
    const line = 'AccountName=prodstore;AccountKey=Zx9kLm2Qp8Vw4Yt6Bn0Hs3Jd7Fg1Ac5EerT8uI0oP2aS4dF6gH8==';
    expect(redactSecrets(line)).toBe('AccountName=prodstore;AccountKey=<redacted>');
  });

  // Grok's 15th prose line (row 30 of its 30), `postgres://user:password@host:5432/db`, is masked on purpose: the URL
  // rule (A6) masks whatever sits in the password slot, and a format string there is indistinguishable
  // from a real one. Not an A37 case — pinned so a later change makes that choice deliberately.
  it('the URL rule still masks the password slot of a format string', () => {
    expect(redactSecrets('Connection string format is postgres://user:password@host:5432/db'))
      .toBe('Connection string format is postgres://user:<redacted>@host:5432/db');
  });
});

// A43, the redactor's half (MEASURED 2026-09-25): redactSecrets runs on the FULL prompt of every
// delegation (preview() collapses whitespace, redacts, THEN truncates), and three of its patterns
// backtracked quadratically on runs that contain `.` or `-`: a scheme start at every word boundary
// (URL credentials), a JWT start after every `-`, and a lazy block scan from every BEGIN marker.
// 64,000 characters of `a.a.a…` took 1.08 s, `eyJ-eyJ-…` 1.87 s — on the path every delegation takes.
describe('A43 — redactSecrets is linear on the inputs that made it quadratic', () => {
  // Each row builds its text from a count, so three runs get three different texts shaped as production's are (preview()
  // folds and trims before it redacts — no text reaches the redactor ending in whitespace) — except the 64,000-space
  // row, whose run production folds to one space; the redactor is timed on it directly.
  it.each([
    ['a.a.a… (URL scheme)', (n: number) => 'a.'.repeat(32_000 + n)],
    ['a-a-a…', (n: number) => 'a-'.repeat(32_000 + n)],
    ['eyJ-eyJ-… (JWT)', (n: number) => 'eyJ-'.repeat(16_000 + n)],
    ['xai-xai-…', (n: number) => 'xai-'.repeat(16_000 + n)],
    // 8,000 markers: the old lazy scan took 47 ms at 2,000 — inside the bound, so the test could not
    // fail — and 862 ms at 8,000 (measured 2026-09-25 against 418c1e9; the fix takes 1 ms).
    ['BEGIN markers with no END', (n: number) => '-----BEGIN RSA PRIVATE KEY-----'.repeat(8_000 + n)],
    ['a credential name, then 64,000 spaces', (n: number) => `password${' '.repeat(64_000 + n)}x`],
    ['one 64,000-char identifier with no =', (n: number) => 'a'.repeat(64_000 + n)],
    ['64,000 chars of name.name.name…', (n: number) => 'db.'.repeat(21_000 + n)],
    ['64,000 chars of k=k=k…', (n: number) => 'k='.repeat(32_000 + n)],
    // Round 22: no row held a digit, and a rule quadratic on a long run of digits passed every test (6 s on 64,000).
    ['64,000 digits', (n: number) => '1234567890'.repeat(6_400) + '7'.repeat(n)],
    // Round 23: and rules quadratic on digits in groups, on one digit repeated, or on a run of capitals passed.
    ['64,000 chars of digit groups', (n: number) => '1234 '.repeat(12_800 + n).trim()],
    ['64,000 of one digit', (n: number) => '7'.repeat(64_000 + n)],
    ['64,000 capitals', (n: number) => 'A'.repeat(64_000 + n)],
  ])('%s', (_label, text) => {
    // The middle of three runs on three different texts: a pause (JIT, GC, a loaded runner) hits one run — round 19 of
    // the pre-merge review saw `k=k=k…` take 250.6 ms once in a full win32 run (25 ms median, 41 ms at most alone) — and a
    // quadratic version is slow on all three, or on two of three in every other row if it is slow on every other call.
    // Round 20: "the fastest of three" on ONE text let the 250 ms bound miss versions quadratic only on a text's first
    // run (cached) or on every other call — only vitest's 5 s timeout failed their rows. Round 21: texts made different by
    // trailing spaces let one quadratic only on texts that do not end in whitespace — every text production passes —
    // through 8 of 9 rows. The middle of three still lets a version slow on only one of three texts (keyed on a length's
    // remainder, round 22) past the 250 ms bound — the BEGIN row's 5 s timeout caught the reviewer's five (round 23), and
    // the hash on history.ts holds a lighter one.
    const times = [0, 1, 2].map((n) => {
      const input = text(n);
      const t0 = performance.now();
      redactSecrets(input);
      return performance.now() - t0;
    }).sort((a, b) => a - b);
    expect(times[1]).toBeLessThan(250);
  });

  it('still masks a JWT and a URL password on the rewritten patterns', () => {
    const jwt = 'eyJ' + 'hbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.aaaaaaaaaaaaaaaaaaaa';
    expect(redactSecrets(`use ${jwt} for auth`)).toBe('use <redacted> for auth');
    expect(redactSecrets('redis://:pw12345678@cache:6379')).toBe('redis://:<redacted>@cache:6379');
    const block = ['-----BEGIN RSA PRIVATE KEY-----', 'MIIEow', '-----END RSA PRIVATE KEY-----', 'then deploy'];
    expect(redactSecrets(block.join(' '))).toBe('<redacted> then deploy');
  });
});

// The pre-merge review of A37/A43 (2026-09-25) ran the rewritten redactor against the one it replaced
// (418c1e9) on the same lines. Most lines below are ones it MEASURED the rewrite getting wrong: a secret
// the old redactor masked and the rewrite wrote verbatim, a line the rewrite made quadratic, or text the
// rewrite's mask took with it. The block also pins leaks BOTH had that the fix closes (`PGPASSWORD`,
// `HMAC_KEY`, `POSTGRES_PASSWORD=12345`), an over-mask both had (`DATABASE_URL: z.string().url()`), and
// guards for the fix's own new paths. Values are assembled at runtime where they look like a provider's
// token (see the A6 note).
describe('A37/A43 pre-merge review — the rewrite measured against the redactor it replaced', () => {
  const jwt = 'eyJ' + 'hbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.aaaaaaaaaaaaaaaaaaaa';
  const K = 'Kx9mQ2vLp7nR4tYw';

  it.each([
    // Run-together names the old `access[_-]?key` rule matched: one segment, not `access` + `key`.
    [`accesskey=${V}`, V], [`ACCESSKEY=${V}`, V], [`privatekey: ${V}`, V], [`PRIVATEKEY=${V}`, V],
    [`"accesskey": "${V}"`, V],
    // A shell default is a real value, not a reference.
    ['password: $' + `{DB_PW:-${V}}`, V], ['password: $' + `{DB_PASSWORD-${V}}`, V],
    ['POSTGRES_PASSWORD: $' + `{POSTGRES_PASSWORD-${V}}`, V], ['DB_PASSWORD=$' + `{DB_PASSWORD:=${V}}`, V],
    // A secret in a placeholder's shape: what it holds is opaque, not a name.
    [`password: $${K}`, K], [`"client_secret": "$${K}"`, K], ['password=$ecr3tPassw0rd99', 'ecr3tPassw0rd99'],
    [`api_key=%${V}%`, V], [`password=<${V}>`, V], [`api_key=your-${V}`, V],
    // A named key behind a prefix is still that key.
    ["process.env.GITHUB_TOKEN = 'abc12345'", 'abc12345'], ['env.NPM_TOKEN=abc12345xyz', 'abc12345xyz'],
    ['--GITHUB_TOKEN=abc12345', 'abc12345'], ["cfg.CONNECTION_STRING='Server=db;Password=hunter2;'", 'hunter2'],
    // A quote with a letter before it: `\b` allowed it, the first lookbehind did not.
    [`x"password": "${V}"`, V],
    // A named key's short number is a key; only a counting word's number is a setting.
    ['XAI_API_KEY=12345', '12345'], ['POSTGRES_PASSWORD=12345', '12345'], ['MYSQL_ROOT_PASSWORD: 1234', '1234'],
    // A JWT right after a `-`, as the old `\b` start found it.
    [`see x-${jwt}`, 'hbGci'], [`cookie=session-${jwt}`, 'hbGci'], [`header X-Token-${jwt}`, 'hbGci'],
    // The same names written run-together, numbered, or qualified by a word the list lacked.
    [`PGPASSWORD=${V}`, V], [`DBPassword: ${V}`, V], [`DB_PASSWORD_2=${V}`, V],
    [`RAILS_MASTER_KEY=${V}`, V], [`HMAC_KEY=${V}`, V],
    // A counting word's number is a setting only when it is short. Grok proposed the first (the review
    // fix had let any number through after `pass`); a PIN-length value is the second.
    ['WIFI_PASS=4829103765', '4829103765'], ['SIM_PASS=1234', '1234'], ['API_TOKEN=482910376512', '482910376512'],
  ])('masks: %s', (line, secret) => {
    const out = redactSecrets(line);
    expect(out).not.toContain(secret);
    expect(out).toContain('<redacted>');
  });

  it.each([
    // Flags and counts that end in a credential word.
    'SKIP_PASS=yes', 'HAS_PASSWORD=yes', 'USE_TOKEN=bearer', 'FIRST_PASS=enabled', 'MAX_OUTPUT_TOKEN=128000',
    // A reference with no value in it.
    'POSTGRES_PASSWORD: $' + '{PG_PW:-}', 'DB_PASSWORD=$' + '{DB_PASSWORD:?required}', 'password: $' + '{var.db_password}',
    'api_key=your_api_key_here',
    // Code and type annotations: a value that calls or indexes something, or names a type.
    'const token = generateToken(user1)', 'JWT_SECRET: z.string().min(32)', 'accessToken: z.string().min(32)',
    'sessionToken: randomUUID4()', 'DB_PASSWORD: str | None = None', 'DB_PASSWORD: SecretStr',
    "const refreshToken = crypto.randomBytes(32).toString('hex')",
    // An empty value: once whitespace is collapsed, the next line's assignment follows it.
    'DB_PASSWORD= DB_HOST=localhost DB_PORT=5432', 'JWT_SECRET= JWT_EXPIRES_IN=3600s',
  ])('leaves alone: %s', (line) => {
    expect(redactSecrets(line)).toBe(line);
  });

  // The re-review of the review fix (2a9c462): 11 kinds of line that 418c1e9 or 52d010b masked and the
  // fix wrote verbatim. Most were unmask rules added to cut over-masking — the answer is structural: the
  // shipped rule reads the same text as the new one and every mask either makes is kept, so nothing it
  // masked can leak (see SHIPPED_ASSIGNMENT and redact-floor.test.ts).
  it.each([
    ['CONNECTION_STRING: Server=db;Database=app;Uid=sa;Pwd=hunter2;', 'hunter2'],
    ['DATABASE_URL: Host=db;Username=app;Password=hunter2', 'hunter2'],
    ['password: Xk9=mQ2vLp7n', 'mQ2vLp7n'],
    [`jq '.password = "${V}"' config.json`, V], [`2fa-secret: JBSWY3DPEHPK3PXP`, 'JBSWY3DPEHPK3PXP'],
    [`3rd-party-api-key: ${V}`, V], [`{"UserName":"admin","PassWord":"${V}"}`, V], [`passWd=${V}`, V],
    ['password: $' + '{LOKI_PASSWORD:-admin123x}', 'admin123x'],
    ['SMTP_PASS=19870412', '19870412'], ['ACCESS_TOKEN=12345678901234567890123456789012', '12345678901234567890123456789012'],
    ['spring.datasource.password=ENC(G6N718UuyPE5bHyWKyuLQSm02auQPUtm)', 'G6N718UuyPE5'], ['DB_PASSWORD=Summer(2024)', 'Summer'],
    [`X-Auth-Token:abc;X-Api-Key: ${V}`, V], ['password: $SUMMER2024X', 'SUMMER2024X'], ['Use password=$K7QX9M2PZL4R.', 'K7QX9M2PZL4R'],
    ['Log in with password: Tr0ub4dor&3.', 'Tr0ub4dor&3'], ['x-GITHUB_TOKEN=abc12345', 'abc12345'],
  ])('the shipped rule is the floor: %s', (line, secret) => {
    expect(redactSecrets(line)).not.toContain(secret);
  });

  // `process.env.API_KEY = apiKey;` and `settings.SECRET_KEY = secret_key` were here too; round 3 measured
  // the rule that left them alone letting "set env.DB_PASSWORD = opensesame" through, so they are masked
  // now — see the over-masks kept on purpose, below.
  it.each([
    'const token = generateToken(user1);', 'MAX_SUBTOKEN=5',
  ])('code and settings the fix had started masking: %s', (line) => {
    expect(redactSecrets(line)).toBe(line);
  });

  // 7M characters of `A_A_…` overflowed the env-name regex (RangeError); recordDelegation swallowed it
  // and wrote no history row. No credential name is that long, so long names are refused before any regex.
  it('an absurdly long name does not throw', () => {
    expect(() => redactSecrets('A_'.repeat(4_000_000) + 'PASSWORD=x')).not.toThrow();
  });

  it.each([
    ['set `DB_PASSWORD=hunter2` in .env', 'set `DB_PASSWORD=<redacted>` in .env'],
    ['Use DB_PASSWORD=hunter2.', 'Use DB_PASSWORD=<redacted>.'],
    ['(DB_PASSWORD=hunter2) then restart', '(DB_PASSWORD=<redacted>) then restart'],
    ['[DB_PASSWORD=hunter2]', '[DB_PASSWORD=<redacted>]'],
    ['DB_PASSWORD=hunter2; npm start', 'DB_PASSWORD=<redacted>; npm start'],
    [`DB_PASSWORD: ${V}. Then deploy`, 'DB_PASSWORD: <redacted>. Then deploy'],
  ])('masks the value and keeps what closes around it: %s', (line, expected) => {
    expect(redactSecrets(line)).toBe(expected);
  });

  // Chosen, not missed: the shipped rule is kept whole, so its own habits stay — a named key's value is
  // masked even when it is code, and a generic name's value takes its closer with it. A capitalized call is
  // read as a value (`Summer(2024)` is one), so a type annotation shaped like it is too. An env-style name
  // after a dot is the key it names even in code (round 3: the rule that read it as code let
  // "set env.DB_PASSWORD = opensesame" through).
  it.each([
    ['DATABASE_URL: z.string().url()', 'DATABASE_URL: <redacted>'],
    [`password: ${V}. Then deploy`, 'password: <redacted> Then deploy'],
    ['API_TOKEN: Optional[str] = None', 'API_TOKEN: <redacted>] = None'],
    ['process.env.API_KEY = apiKey;', 'process.env.API_KEY = <redacted>;'],
    ['settings.SECRET_KEY = secret_key', 'settings.SECRET_KEY = <redacted>'],
    ['self.DB_PASSWORD = password', 'self.DB_PASSWORD = <redacted>'],
  ])('an over-mask kept on purpose: %s', (line, expected) => {
    expect(redactSecrets(line)).toBe(expected);
  });

  // The chains the review timed: `pwd=${…` took 268 ms at 64,000 chars, 1.0 s at 128,000 and 17.4 s at
  // 512,000 — every head re-read the rest of the run, because a skipped value was not consumed. 128,000
  // here, so a fast machine cannot pass the quadratic version under the bound: on the pre-fix code
  // (566ba73) these four took about 0.4–1.1 s.
  const chain = (unit: string) => unit.repeat(Math.ceil(128_000 / unit.length));
  it.each([
    ['pwd=${ chain', 'pwd=$' + '{'],
    ['DB_PASSWORD=${ chain', 'DB_PASSWORD=$' + '{'],
    ['token:${ chain', 'token:$' + '{'],
    ['A_PASSWORD=${ chain (the input D6 was found with)', 'A_PASSWORD=$' + '{'],
  ])('%s stays linear', (_label, unit) => {
    const input = chain(unit);
    const t0 = performance.now();
    redactSecrets(input);
    expect(performance.now() - t0).toBeLessThan(250);
  });

  // Guards for the fix's own new paths — a shell default, code, the next line's assignment. They are
  // linear on the pre-fix code too, so they cannot catch the regression above; they keep the new paths
  // from introducing one.
  it.each([
    ['a shell-default chain', 'A_PASSWORD=$' + '{A_PASSWORD:-'],
    ['a code chain', 'password=f('],
    ['an empty-value chain', 'DB_PASSWORD= '],
    // Round 3's re-reads. The first draft resumed on a key at a value's START whose value ran on through
    // the rest of the run: 128,000 chars of this took 1.65 s (512,000: 29 s).
    ['a key-in-value chain', 'pwd=X_TOKEN='],
    ['a bare-key chain', 'password: client-secret: '],
    ['a glued-key chain', 'PassWd=1;DATABASE_URL= '],
  ])('%s stays linear', (_label, unit) => {
    const input = chain(unit);
    const t0 = performance.now();
    redactSecrets(input);
    expect(performance.now() - t0).toBeLessThan(250);
  });
});

// Round 3 of the pre-merge review (2026-09-25), on the round-2 fix (09383ab). Most lines below were measured
// written verbatim by it while the round before (d3b4548) masked them; some leaked in both (`OTP_TOKEN`,
// `PGPASSWORD`, `summer(2024)`), and four pin shapes the fuzzing found while this fix was written — 09383ab
// and d3b4548 masked those; v0.2.35 did not, nor, for the first two, the code before the review, 566ba73
// (`pwd:API_KEY: ;I_TOKEN`, `pass=TOKEN =0:…`, the two URLs inside a masked value; rounds 4 and 5 measured).
// The floor itself — nothing v0.2.35 masked may show — has its own test against the frozen v0.2.35 redactor
// (redact-floor.test.ts).
describe('A37 pre-merge review, round 3 — what the round-2 fix let through', () => {
  it.each([
    // Only a WHOLE call is code. A value that merely starts like one is not: the rule that read only the
    // start let 1.5% of random 16-character passwords through (`k7(…`).
    ['DB_PASSWORD=k7(Xq2mZ9pL4!vB', ['Xq2mZ9pL4']],
    ['export SMTP_PASSWORD=summer(2024)x && npm start', ['summer(2024)x']],
    ['dbPassword: k7(Xq2mZ9pL4!vB', ['Xq2mZ9pL4']],
    ['STRIPE_SECRET=q4[Zm8Lp2Vx9Kt', ['Zm8Lp2Vx9Kt']],
    // Nor is a whole call to a plain word — the shape of a human password with a number in brackets.
    ['DB_PASSWORD=summer(2024)', ['summer']], ['DB_PASSWORD=hunter2(x);', ['hunter2']],
    ['--set WIFI_PASS = correct(7175);', ['correct']], ['then SESSION_SECRET=staple[6452].', ['staple']],
    // A dotted name's leaf is the key it names — written tight (helm `--set`) or with spaces.
    ['helm upgrade --install api ./chart --set env.DB_PASSWORD=Winter2024! --set env.JWT_SECRET=supersecretvalue',
      ['Winter2024!', 'supersecretvalue']],
    ['use env.DB_PASSWORD = sunshine&pwd=DtnnnxrBvBdqkUgl;', ['sunshine', 'DtnnnxrBvBdqkUgl']],
    // A short value left unmasked is read again for a name inside it.
    ['PassWd=MASTER_KEY=VshY', ['VshY']], ['PassWd=passphrase= VCKvVkOH9whf', ['VCKvVkOH9whf']],
    // A key glued to the end of a value, and a value that is itself the next key, are read as keys (the
    // review's fuzzer shrank its lines to these).
    ['PassWd=1;DATABASE_URL= MAST', ['MAST']], ['PassWd=4Ww&API_KEY: OssV', ['OssV']],
    ['PassWd=0&dbPassword =tMumLZq7mDrO', ['tMumLZq7mDrO']], ['pwd:API_KEY: ;I_TOKEN =jkm1', ['jkm1']],
    ['pass=TOKEN =0:dbPassword =TDdXYMre1KZy', ['TDdXYMre1KZy']],
    // A call followed by a sentence's `.` is not a call.
    ['T_SECRET=kJtw().', ['kJtw']], ['PASS=sNAW9[dMYJt6].', ['sNAW9']],
    // A URL's password inside a value another rule masked: the wider URL rule reads the same text.
    ['Password==://qVGeDO9=":iqXl@', ['iqXl']], ['pass=7HcVkM:?+://,:WORD@', ['WORD']],
    // The floor read the next YAML key as a named key's value and masked it — so the new rule, reading the
    // floor's output, never saw that key's own value. Both now read the same text.
    ['environment: DATABASE_URL: POSTGRES_PASSWORD: S3cretPass2024 POSTGRES_USER: app', ['S3cretPass2024']],
    ['curl "https://api.example.com/v1/export?apiToken=Swordfish&secret=hU7xK2pQ9zL4mN8r"', ['Swordfish', 'hU7xK2pQ9zL4mN8r']],
    // An empty YAML key before a lower-case child key: the child's own value is read too.
    ['spring: datasource: password: client-secret: abcDEF123456ghi', ['abcDEF123456ghi']],
    ['github: token: accessToken: ya29a0AfH6SMBx9Kq2', ['ya29a0AfH6SMBx9Kq2']],
    [`DB_PASSWORD: dbPassword: ${V}`, [V]],
    ['auth: PassWord: ApiToken: Zx81Qw72Er63Ty54', ['Zx81Qw72Er63Ty54']],
    // A short number is a setting only after a COUNTING token (`MAX_…`, `…_OUTPUT_…`), not after any word
    // ending in `token`: an OTP or a PIN is a secret.
    ['TWILIO_AUTHTOKEN=4821937', ['4821937']], ['OTP_TOKEN=482193', ['482193']], ['PIN_TOKEN=1234', ['1234']],
    // Grok's round-3 pass: libpq's own variable, shouted with its prefix written in, is an env name — it
    // was written verbatim in every version (the env-name test wanted an `_`).
    ['export PGPASSWORD=OpenSesamePlease', ['OpenSesamePlease']], ['GITHUBTOKEN=kittens', ['kittens']],
  ])('masks: %s', (line, secrets) => {
    const out = redactSecrets(line);
    for (const secret of secrets) expect(out).not.toContain(secret);
  });

  it.each([
    // Whole calls, and calls cut at a quote, are still code.
    'DB_PASSWORD = os.getenv("DB_PASSWORD")', "API_KEY = config.get('api_key')", 'SECRET_KEY = secrets.token_hex(32)',
    'SECRET_KEY = env("SECRET_KEY")',
    // A shouted credential word with no prefix is not an env name: prose writes it.
    'PASSWORD: see the vault entry', 'TOKEN: rotate it weekly',
    // Counting tokens.
    'MAX_COMPLETION_TOKEN=4096', 'CONTEXT_TOKEN=128000',
  ])('leaves alone: %s', (line) => {
    expect(redactSecrets(line)).toBe(line);
  });

  // The v0.2.35 URL and key-block rules run exactly as they matched then, so the floor reads what it read
  // then; the A43 widening to any `://user:pass@` reads that same text beside the assignment rules, where
  // it cannot change what they read.
  it.each([
    ['password: my_db://app:pw1@dbhost', 'password: <redacted>'],
    ['connect to my_db://app:pw1@dbhost', 'connect to my_db://app:<redacted>@dbhost'],
    // v0.2.35 masked `@iand`; the wider URL rule adds `CONNECTION_STRING=` (the "password"), and the two
    // touching masks are one.
    ['://:CONNECTION_STRING=@iand', '://:<redacted>'],
    ['secret=Tiger-----BEGIN RSA PRIVATE KEY----- a -----BEGIN CERTIFICATE----- b -----END RSA PRIVATE KEY-----99',
      'secret=<redacted>'],
    ['environment: DATABASE_URL: POSTGRES_PASSWORD: S3cretPass2024 POSTGRES_USER: app',
      'environment: DATABASE_URL: <redacted> <redacted> POSTGRES_USER: app'],
  ])('exactly: %s', (line, expected) => {
    expect(redactSecrets(line)).toBe(expected);
  });
});

// Round 4 of the pre-merge review (2026-09-26), on the round-3 fix (2d5ad95). A call or a reference is kept
// whole and not read again, so a credential name's assignment INSIDE one was never seen. The review's shrunk
// lines: the round-2 fix (09383ab) masked the first four; the last leaked in v0.2.35 and in the round-1 to
// round-3 fixes (the code before the review, 566ba73, masked it).
describe('A37 pre-merge review, round 4 — an assignment held inside a call or a reference', () => {
  it.each([
    ['password: token: getConfig(dbPassword:Xk9mQ2vLp7nR4tYw)', ['Xk9mQ2vLp7nR4tYw']],
    ['pwd=ab&X_TOKEN= getConfig(dbPassword:Xk9mQ2vLp7nR4tYw)', ['Xk9mQ2vLp7nR4tYw']],
    ['PassWd=1;API_TOKEN= loadConfig(env.DB_PASSWORD:Xk9mQ2vLp7nR4tYw)', ['Xk9mQ2vLp7nR4tYw']],
    ['DATABASE_URL==on|JWT_SECRET= $' + '{X?MAX_TOKEN:Xk9mQ2vLp7nR4tYw/x', ['Xk9mQ2vLp7nR4tYw']],
    ['DB_PASSWORD= getConfig(dbPassword:Xk9mQ2vLp7nR4tYw)', ['Xk9mQ2vLp7nR4tYw']],
  ])('masks: %s', (line, secrets) => {
    const out = redactSecrets(line);
    for (const secret of secrets) expect(out).not.toContain(secret);
  });

  it.each([
    // A call or a reference that holds no credential name's assignment is still code, or still a reference.
    'SECRET_KEY = secrets.token_hex(32)', 'const token = generateToken(user1);',
    'DB_PASSWORD=$' + '{DB_PASSWORD:?required}', 'DB_PASSWORD=$' + '{DB_PASSWORD:?error:unset}',
    'API_TOKEN = fetchToken(scope:admin)',
  ])('leaves alone: %s', (line) => {
    expect(redactSecrets(line)).toBe(line);
  });

  // Looking inside a call or a reference must not read the same run again from every head.
  const chain = (unit: string) => unit.repeat(Math.ceil(128_000 / unit.length));
  it.each([
    ['a call-holding-a-key chain', 'token:getX(a:1)'],
    ['a key-in-call chain', 'token:getX(dbPassword:'],
    ['a reference chain', 'JWT_SECRET=$' + '{X?A_TOKEN:'],
  ])('%s stays linear', (_label, unit) => {
    const input = chain(unit);
    const t0 = performance.now();
    redactSecrets(input);
    expect(performance.now() - t0).toBeLessThan(250);
  });
});

// Round 5 of the pre-merge review (2026-09-26), on the round-4 fix (07ecb41). A call or a reference is a value
// only when an assignment inside it would be masked on its own: any credential name had been enough, and 10 of
// the review's 50 secret-free lines were masked (`${API_KEY:?API_KEY:required}`, a GraphQL argument). And three
// wrong versions of the check passed every test: one read only the first name, one only `name:`, and one re-read
// the text from every name (1.58 s on one 64K-character call).
describe('A37 pre-merge review, round 5 — an assignment inside a call or a reference, judged on its own', () => {
  it.each([
    // Not only the first name inside, and `=` as well as `:` — v0.2.35 and the round-1 to round-3 fixes wrote
    // both verbatim (the code before the review, 566ba73, masked them); the round-4 fix, 07ecb41, masked them.
    ['DB_PASSWORD= vault.read(path:kv|dbPassword:Xk9mQ2vLp7nR4tYw)', ['Xk9mQ2vLp7nR4tYw']],
    ['JWT_SECRET=$' + '{X?DB_PASSWORD=Xk9mQ2vLp7nR4tYw}', ['Xk9mQ2vLp7nR4tYw']],
    // An inner value is read only so far; one that goes on past that is judged masked — its first stretch alone
    // (all dashes) would be kept, and the secret after it would show.
    ['DB_PASSWORD= cfg.get(DB_PASS:' + '-'.repeat(70) + 'Xk9mQ2vLp7nR4tYw)', ['Xk9mQ2vLp7nR4tYw']],
    // Inside brackets a credential name is evidence, as an env-style name is — prose does not write
    // `password:hunter2` there — so a short plain value counts. Judged like a bare `password:` it would be kept,
    // and a first draft of this fix let these through.
    ['DB_PASSWORD= getConfig(dbPassword:hunter2)', ['hunter2']], ['token = vault.read(secret:Q7HdIE5Y)', ['Q7HdIE5Y']],
  ])('masks: %s', (line, secrets) => {
    const out = redactSecrets(line);
    for (const secret of secrets) expect(out).not.toContain(secret);
  });

  it.each([
    // The assignment inside is nothing to mask on its own — empty, an error text's flag word, a placeholder.
    'API_KEY=$' + '{API_KEY:?API_KEY:required}', 'POSTGRES_PASSWORD=$' + '{POSTGRES_PASSWORD:?POSTGRES_PASSWORD:unset}',
    'JWT_SECRET=$' + '{JWT_SECRET?JWT_SECRET:missing}', 'authToken: createSession(password:$password)',
    'API_KEY=$' + '{API_KEY:?API_KEY:}',
  ])('leaves alone: %s', (line) => {
    expect(redactSecrets(line)).toBe(line);
  });

  // Chosen, not missed: a named argument written without a space holds a plausible value, so the call is a value.
  it.each([
    ['token = client.createToken(secret:cfg.signingSecret)', 'token = <redacted>)'],
    ['API_KEY = cfg.get(api_key:default)', 'API_KEY = <redacted>)'],
  ])('an over-mask kept on purpose: %s', (line, expected) => {
    expect(redactSecrets(line)).toBe(expected);
  });

  // Here the check itself reads the whole call or reference — the three linear tests above never made it read
  // more than 15 of their 128,000 characters. 512,000 characters: about 60 ms here; a version that re-scanned
  // the rest of the text at every name at memchr speed took 73 ms at 128,000 and 1.0 s at 512,000. Round 10: at
  // 512,000 the 250 ms bound failed on the fix itself under the whole suite's load (270 ms, win32). Round 11: at
  // 1,024,000 with 1,500 ms that version passed on glibc Linux (1.3 to 1.5 s — glibc's memchr is fast; win32 4.8 to
  // 5.2 s), so the CI job on Linux would not have caught it. At 2,048,000 the fix takes 245 to 515 ms (win32, glibc,
  // musl) and that version 5.1 s (glibc) to 36 s (musl), so the bound is 2,500 ms.
  it.each([
    ['a call holding many names', 'DB_PASSWORD= cfg.get(' + 'x:1|'.repeat(512_000) + 'y)'],
    ['a reference holding many names', 'JWT_SECRET=$' + '{X?' + 'x:1|'.repeat(512_000)],
  ])('%s stays linear', (_label, input) => {
    const t0 = performance.now();
    redactSecrets(input);
    expect(performance.now() - t0).toBeLessThan(2_500);
  });
});

// Round 6 of the pre-merge review (2026-09-26), on the round-5 fix (2f92b54): the check worked, but eight plausible
// wrong versions of it failed no test — three never returned, two were quadratic, three leaked or over-masked.
describe('A37 pre-merge review, round 6 — the inner judgment, pinned', () => {
  it.each([
    // A numeric value inside brackets is not a setting: only an env-style counting name keeps its count there, when
    // the count ends the value (`MAX_TOKEN:4096` — pinned in the round-8 block); a camelCase or snake_case one's
    // number is masked too (`getConfig(maxToken:4096)`, an over-mask the release note lists).
    ['DB_PASSWORD= getConfig(dbPassword:4829103)', ['4829103']],
    // An inner value runs to the end of the value, brackets included.
    ['DB_PASSWORD= cfg.get(dbPassword:[Xk9mQ2vLp7nR4])', ['Xk9mQ2vLp7nR4']],
  ])('masks: %s', (line, secrets) => {
    const out = redactSecrets(line);
    for (const secret of secrets) expect(out).not.toContain(secret);
  });

  it.each([
    // A longer placeholder is still a placeholder; an inner call that closes the value is still code. The second
    // line never returned on a version whose inner judgment looked inside again: that reset the scan's shared
    // regex, and the scan read the same name forever. The scan now keeps its place; looking inside again is caught
    // by the timing tests below.
    'authToken: createSession(password:$sessionPassword)', 'DB_PASSWORD= _f(a)password:_g(b)',
  ])('leaves alone: %s', (line) => {
    expect(redactSecrets(line)).toBe(line);
  });

  // The read cap and the run-start rule keep the check linear. Without a cap a chain of references grows with the
  // square of its length; with `\b` for the run start a dotted call took 3.6 s at 64,000 characters (x4 per
  // doubling). 128 chains of 8,000 characters catch any cap from about 8,000 up — with the cap at 100,000 they took
  // 1.2 s here, the fix 6 ms. One chain of 128,000 did not: its first name's value reached that cap, which ended the
  // check. The inner judgment does not look inside its value again, so each name is judged once; looking inside
  // again, a reference nested eight deep or a call chaining eight calls was judged once per path (2^8), and the
  // last two inputs took 0.95 to 1.25 s here (the fix 40 to 50 ms). Round 10: those two are the only tests that
  // catch looking inside again, and their 250 ms bound failed on the fix itself under a contended CPU (the round-9
  // reviewer's contended runs, 5 and 7 in 10). At twice the size they take 2.6 to 3.8 s looking inside again and
  // about 100 to 140 ms as fixed (win32, round 10), so they are held to 1,000 ms.
  const reference = 'JWT_SECRET=$' + '{X?';
  const inner = 'pwd:$' + '{X?';
  it.each([
    ['chains of references holding credential names', (reference + inner.repeat(1_000) + ' ').repeat(128), 250],
    ['a call holding one long dotted run', 'DB_PASSWORD= cfg.get(' + 'a.'.repeat(64_000) + 'b)', 250],
    ['references nested eight deep', (reference + inner.repeat(7) + 'pwd:$Y ').repeat(9_000), 1_000],
    ['calls chaining eight calls', ('DB_PASSWORD= _f()' + 'pwd:_g()'.repeat(8) + ' ').repeat(8_600), 1_000],
  ])('%s stays linear', (_label, input, bound) => {
    const t0 = performance.now();
    redactSecrets(input);
    expect(performance.now() - t0).toBeLessThan(bound);
  });
});

// Round 7 of the pre-merge review (2026-09-26), on the round-6 fix (4709ab7): the check behaved as before, and
// more wrong versions of it failed no test — one quadratic (the inner scan's run start without `-`: 22 s at 128,000
// characters, x4 per doubling), two that stop reading early and would leak what this one masks (only the first 64
// characters of a reference's error text; only the first eight names), and read caps from 1,024 to 7,000 (linear,
// slower in step with the cap on an input aimed at it — 20 to 35 times at 1,024, 80 to 170 at 4,096, 150 to 280 at
// 7,000, over three reviews' measurements).
describe('A37 pre-merge review, round 7 — the inner scan, pinned', () => {
  it.each([
    // Past a long error text, and past eight other names, the assignment is still read.
    ['JWT_SECRET=$' + '{JWT_SECRET:?set-it-in-the-deployment-environment-before-starting-the-app|dbPassword:hunter2}', ['hunter2']],
    ['DB_PASSWORD= cfg.get(a:1|b:2|c:3|d:4|e:5|f:6|g:7|h:8|dbPassword:Xk9mQ2vLp7nR4tYw)', ['Xk9mQ2vLp7nR4tYw']],
  ])('masks: %s', (line, secrets) => {
    const out = redactSecrets(line);
    for (const secret of secrets) expect(out).not.toContain(secret);
  });

  // The read cap is 64 characters, and a value that reaches it is masked: 62 dashes and the call's `)` are judged
  // on their own (punctuation — kept), 63 and the `)` reach the cap. A reference's `}` ends the run, so there it is
  // 63 and 64 dashes. Any other cap moves one of these lines.
  it.each([
    ['DB_PASSWORD= cfg.get(dbPassword:' + '-'.repeat(62) + ')', false],
    ['DB_PASSWORD= cfg.get(dbPassword:' + '-'.repeat(63) + ')', true],
    ['JWT_SECRET=$' + '{X?dbPassword:' + '-'.repeat(63) + '}', false],
    ['JWT_SECRET=$' + '{X?dbPassword:' + '-'.repeat(64) + '}', true],
  ])('the read cap is 64 characters: %s → masked %s', (line, masked) => {
    expect(redactSecrets(line) !== line).toBe(masked);
  });
  // The cap counts UTF-16 units, as the rest of the scan does. A version with the `u` flag read 65 units (64 code
  // points), so the length check never saw the cap and the secret after an astral character was written (round 12);
  // one that counted code points throughout left 32 astral characters (64 units) unmasked (round 13).
  it.each([
    ['a secret after an astral character', 'DB_PASSWORD= cfg.get(dbPassword:' + String.fromCodePoint(0x1f511) + '-'.repeat(63) + 'hunter2)'],
    ['32 astral characters, 64 units', 'DB_PASSWORD= cfg.get(dbPassword:' + String.fromCodePoint(0x1f511).repeat(32) + ')'],
  ])('the read cap counts UTF-16 units: %s', (_label, line) => {
    expect(redactSecrets(line)).toBe('DB_PASSWORD= <redacted>)');
  });

  // Every character that continues a name keeps a run from being read again from inside it — digits and `_` too
  // (round 12: a run start without either was quadratic, 14 to 21 s for these two, and passed every test).
  it.each([
    ['a call holding one long dashed run', 'DB_PASSWORD= cfg.get(' + 'a-'.repeat(64_000) + 'b)'],
    ['a call holding one long word', 'DB_PASSWORD= cfg.get(' + 'a'.repeat(128_000) + ')'],
    ['a call holding letters and digits', 'DB_PASSWORD= cfg.get(' + 'a1'.repeat(64_000) + ')'],
    ['a call holding letters and underscores', 'DB_PASSWORD= cfg.get(' + 'a_'.repeat(64_000) + ')'],
    // Capital letters too (round 13: a run start written for lowercase only took 29 to 35 s on the first, 14 to 21 s
    // on the second).
    ['a call holding one long capitalised word', 'DB_PASSWORD= cfg.get(' + 'A'.repeat(128_000) + ')'],
    ['a call holding capitals and lowercase', 'DB_PASSWORD= cfg.get(' + 'Aa'.repeat(64_000) + ')'],
  ])('%s stays linear', (_label, input) => {
    const t0 = performance.now();
    redactSecrets(input);
    expect(performance.now() - t0).toBeLessThan(250);
  });
});

// Round 8 of the pre-merge review (2026-09-26), on the round-7 fix (f214226): round 7 pinned the reviewer's
// constants — 64 characters, eight names — not the property, and seven more wrong versions failed no test and would
// leak: judging only the first credential name (one statement: `return verdict === 'mask'`), reading only the first 83
// characters of a call or 75 of a reference, stopping after 9, 16 or 64 names, and a head without its `-`/`--`.
// The check reads the whole text and judges every name.
describe('A37 pre-merge review, round 8 — the whole text, every name', () => {
  it.each([
    // The first credential name's value is kept (a code call, a reference); the second one's is a secret.
    ['DB_PASSWORD= _f(a)pass:_g(dbPassword:hunter2)', ['hunter2']],
    ['JWT_SECRET=$' + '{X?pass:$' + '{Y?dbPassword:hunter2}', ['hunter2']],
    // Many credential names, the secret last. Each inner value runs to the end of the text or to the 64-character cap
    // (no terminator can sit inside the text this check reads — the top-level value stops at the same ones), so a
    // chain has to fit in the 63 characters after the first name. `pwd` is the shortest credential word: a reference
    // level `${A?pwd:` is 8 characters, a call level `_()pwd:` 7 (every suffix after a call level must be a balanced
    // call itself, so none is shorter). Through unquoted references eight names fit — 3 × 9 + 3 × 8 + 10 + `Qk` is
    // 63 (the trailing `)` of a call level is trimmed there); through calls, and quoted references holding calls, nine
    // — 3 × 8 + 4 × 7 + `_(pwd:Qkz)` is 62 — and ten would need 64. The secrets are short and under `token`/`pwd`
    // values the floor leaves (a `pwd:hunter2` there is masked whatever this check does). Stopping after one to seven
    // names leaks the first line, after eight the third; the round-11 and round-12 reviewers' searches (pruned only by
    // that length; the second seeded from the nine-name chain) found no line where stopping after nine leaks. Round 9's
    // chains had 9 characters at their shortest and it called six the most, and a version one past that leaked; round
    // 10 counted call levels only as `pass:_()` (8) and called eight the most, and the version stopping at eight leaked.
    ['JWT_SECRET=$' + '{X?pass:' + ('$' + '{A?pass:').repeat(3) + ('$' + '{A?pwd:').repeat(3) + '$' + '{A?token:Qk}', ['Qk']],
    ['DB_PASSWORD= _()' + 'pass:_()'.repeat(6) + 'pass:_(pass:hunter2)', ['hunter2']],
    ['DB_PASSWORD= _()' + 'pass:_()'.repeat(4) + 'pwd:_()'.repeat(3) + 'pwd:_(pwd:Qkz)', ['Qkz']],
    // A masked credential before a kept one: the first mask decides. A version where the last credential's verdict
    // decided passed every other test (round 9).
    ['DB_PASSWORD= cfg.get(dbPassword:hunter2|pass:$PASS)', ['hunter2']],
    ['JWT_SECRET=$' + '{X?dbPassword:hunter2|pass:$PASS}', ['hunter2']],
    // A value that runs on past a `|`, and a reference's inner value cut at an open bracket, are still values:
    // an inner read stopping at `|`, and the inner judgment reading an open bracket as a call cut at a quote,
    // passed every other test (round 9).
    ['DB_PASSWORD= cfg.get(DB_PASS:' + '-'.repeat(60) + '|Xk9mQ2vLp7nR4tYw)', ['Xk9mQ2vLp7nR4tYw']],
    ['JWT_SECRET=$' + '{X?pass:tr0ub4dor[}', ['tr0ub4dor']],
    // A head written as a flag is a head, and so is a name that starts with `_` (round 12: a head read from a letter
    // only passed every test and wrote these secrets).
    ['DB_PASSWORD= cfg.get(--dbPassword:hunter2)', ['hunter2']],
    ['JWT_SECRET=$' + '{X?-dbPassword:hunter2}', ['hunter2']],
    ['DB_PASSWORD= cfg.get(_authToken:hunter2)', ['hunter2']],
    ['JWT_SECRET=$' + '{X?_pwd:hunter2}', ['hunter2']],
    // …and after a flag's dashes (round 13: a head that took `_` only at the very start passed and wrote these).
    ['DB_PASSWORD= cfg.get(-_pwd:hunter2)', ['hunter2']],
    ['DB_PASSWORD= cfg.get(--_authToken:hunter2)', ['hunter2']],
    ['JWT_SECRET=$' + '{X?--_authToken:hunter2}', ['hunter2']],
    // A long credential name — up to the 256 characters a name may have — is read whole (round 14: a version that
    // read at most 64 characters of a name passed every test and wrote these).
    ['DB_PASSWORD= cfg.get(spring.cloud.azure.keyvault.secret.property-source.credential.client-secret:hunter2)', ['hunter2']],
    ['DB_PASSWORD= cfg.get(' + 'k'.repeat(247) + '_password:hunter2)', ['hunter2']],
    ['JWT_SECRET=$' + '{X?' + 'k'.repeat(247) + '_password:hunter2}', ['hunter2']],
  ])('masks: %s', (line, secrets) => {
    const out = redactSecrets(line);
    for (const secret of secrets) expect(out).not.toContain(secret);
  });

  // The claim in the round-6 block: inside brackets an env-style counting name keeps its count when the count ends
  // the value (a version that never kept one there masked these). Followed by more code (`.stream()`) it is masked —
  // an over-mask the release note lists.
  // An empty inner value is not a value to mask (a version that masked it passed every test — round 12).
  it.each([
    'DB_PASSWORD= getConfig(MAX_TOKEN:4096)', 'JWT_SECRET=$' + '{X?MAX_OUTPUT_TOKEN:128000}', 'DB_PASSWORD= cfg.get(SMTP_PASS:12)',
    'DB_PASSWORD= cfg.get(pwd:)',
  ])('leaves alone: %s', (line) => {
    expect(redactSecrets(line)).toBe(line);
  });

  // The first and the last name of a 512,000-character call or reference are read: a version that stopped after the
  // first N characters or N names, for any N that stops before the last name, shows the first pair's secret; one
  // that read only the last N characters (round 9: 128 and 1,024 passed every other test) shows the second's. Content
  // only — the time these take is pinned elsewhere, and a bound here only added a way to fail on a slow machine.
  it.each([
    ['call, last name', 'DB_PASSWORD= cfg.get(' + 'x:1|'.repeat(128_000) + 'dbPassword:hunter2)'],
    ['reference, last name', 'JWT_SECRET=$' + '{X?' + 'x:1|'.repeat(128_000) + 'dbPassword:hunter2'],
    ['call, first name', 'DB_PASSWORD= cfg.get(dbPassword:hunter2|' + 'x:1|'.repeat(128_000) + 'y)'],
    ['reference, first name', 'JWT_SECRET=$' + '{X?dbPassword:hunter2|' + 'x:1|'.repeat(128_000)],
    // Round 10: a version that read the first N and the last N characters (128, 1,024, 65,536) passed every test.
    ['call, a name in the middle', 'DB_PASSWORD= cfg.get(' + 'x:1|'.repeat(64_000) + 'dbPassword:hunter2|' + 'x:1|'.repeat(64_000) + 'y)'],
    ['reference, a name in the middle', 'JWT_SECRET=$' + '{X?' + 'x:1|'.repeat(64_000) + 'dbPassword:hunter2|' + 'x:1|'.repeat(64_000)],
  ])('a long %s is read', (_label, input) => {
    expect(redactSecrets(input)).not.toContain('hunter2');
  });

  // …and a long one without a credential is left alone: a version that judged any call or reference past 4,096
  // characters as masked passed every test — the other long secret-free inputs are timed, not read (round 10).
  it.each([
    ['call', 'DB_PASSWORD= cfg.get(' + 'x:1|'.repeat(128_000) + 'y)'],
    ['reference', 'JWT_SECRET=$' + '{X?' + 'x:1|'.repeat(128_000) + 'y}'],
  ])('a long %s without a credential is left alone', (_label, input) => {
    expect(redactSecrets(input)).toBe(input);
  });
});

// Round 10 of the pre-merge review (2026-09-26), on the round-9 fix (dbebdf2): round 9 pinned the reviewer's `|`,
// not the property — an inner value runs past every character but whitespace, quotes, `,` and `}`, and a name after
// any character that cannot continue a name is a head. Round 10 pinned 26 characters; round 11 found versions that
// stopped at a backtick, a non-ASCII or a control character, or read no head after one, passing every test; round 12
// found U+0000 and U+007F to U+009F left out of the round-11 range; round 13 found typographic quotes, CJK punctuation,
// zero-width characters and non-characters beyond the round-12 range — so this runs every UTF-16 code unit (a lone
// surrogate included) and a few astral characters that is not a terminator, in one loop (a few seconds), and pins the
// terminator class over every code unit. A terminator ends the value (the release note lists what leaks past one).
// For `(`, `)`, `[`, `]` and `=` the call line is masked by the top-level code rules anyway; the reference line carries
// those. After a character that continues a name (a letter, a digit, `_`, `.`, `-`) the "name after" line reads one
// longer name that still ends in a credential word. After any other character a short name is its own name: round 14
// found versions whose name took `$`, `/`, `@` or any non-ASCII character in, their run start unchanged — they read
// `a$pwd` whole (no credential word) and a long run of `a$` quadratically (14 to 26 s on 128,000 characters). One
// line taking long is a slowdown the per-character tests this loop replaced would each have timed out on (round 14).
// The same short name right at the start of the inner text: round 15 found a version whose name could start with `$`
// (or `@`, or a non-ASCII letter) read `$pwd` whole, passing every test — the loop had always put `a` before it.
describe('A37 pre-merge review, rounds 10 to 19 — every separator, and the file as reviewed', () => {
  const TERMINATOR = /[\s"',}]/;
  const hex = (c: string) => c.codePointAt(0)!.toString(16);
  const units = Array.from({ length: 0x10000 }, (_v, i) => String.fromCharCode(i));
  it('the terminators are these and no others, over every UTF-16 code unit', () => {
    // tab, LF, VT, FF, CR, space, `"`, `'`, `,`, `}`, and the rest of JavaScript's `\s`
    expect(units.filter((c) => TERMINATOR.test(c)).map(hex)).toEqual(['9', 'a', 'b', 'c', 'd', '20', '22', '27', '2c', '7d',
      'a0', '1680', '2000', '2001', '2002', '2003', '2004', '2005', '2006', '2007', '2008', '2009', '200a', '2028', '2029',
      '202f', '205f', '3000', 'feff']);
  });
  it('past every other code unit the value runs on, and a name after it is read', () => {
    const astral = [0x1f511, 0x10000, 0x10ffff, 0xe0001].map((p) => String.fromCodePoint(p));
    const NAME_CHARACTER = /[A-Za-z0-9_.-]/;
    const missed: string[] = [];
    let slowest = 0;
    for (const c of [...units.filter((u) => !TERMINATOR.test(u)), ...astral]) {
      const lines: Array<[string, string]> = [
        ['value past, call', 'DB_PASSWORD= cfg.get(dbPassword:none' + c + 'hunter2)'],
        ['value past, reference', 'JWT_SECRET=$' + '{X?dbPassword:none' + c + 'hunter2}'],
        ['name after, call', 'DB_PASSWORD= cfg.get(a' + c + 'dbPassword:hunter2)'],
        ['name after, reference', 'JWT_SECRET=$' + '{X?a' + c + 'dbPassword:hunter2}'],
      ];
      if (!NAME_CHARACTER.test(c)) {
        lines.push(['short name after, call', 'DB_PASSWORD= cfg.get(a' + c + 'pwd:hunter2)'],
          ['short name after, reference', 'JWT_SECRET=$' + '{X?a' + c + 'pwd:hunter2}'],
          ['short name right after, call', 'DB_PASSWORD= cfg.get(' + c + 'pwd:hunter2)'],
          ['short name right after, reference', 'JWT_SECRET=$' + '{X?' + c + 'pwd:hunter2}']);
      }
      for (const [kind, line] of lines) {
        const t0 = performance.now();
        const out = redactSecrets(line);
        slowest = Math.max(slowest, performance.now() - t0);
        if (out.includes('hunter2')) missed.push(kind + ' U+' + hex(c));
      }
    }
    expect(missed).toEqual([]);
    expect(slowest).toBeLessThan(1_000);
  }, 60_000);
  // …and no two-character sequence joins names either: every pair of printable ASCII characters that are neither
  // terminators nor letters or digits (a name's `-`, `.` and `_` included, two of those together left out) between `a`
  // and a short name. Round 15 found a version whose name read `->` as a joiner, its run start unchanged — it read
  // `a->pwd` whole and a long run of `a->` quadratically (23 to 26 s on 128,000 characters). A pair ending in `.` is left
  // out: a name does not start at a dot, so the call `a!.pwd:` is left by v0.2.35 and every fix since round 1 (the code
  // before the review, 566ba73, masked the whole value) and the reference by every version (the release note lists it).
  // A joiner that keeps the credential word last (`>-`) masks anyway, so no line here can see it — the next tests pin
  // the patterns and the file themselves (rounds 16 and 17).
  it('no two-character sequence joins a name to the one after it', () => {
    const pairCharacters = Array.from({ length: 0x5e }, (_v, i) => String.fromCharCode(0x21 + i))
      .filter((c) => !TERMINATOR.test(c) && (!/[A-Za-z0-9]/.test(c)));
    const missed: string[] = [];
    for (const x of pairCharacters) {
      for (const y of pairCharacters) {
        if ((/[_.-]/.test(x) && /[_.-]/.test(y)) || y === '.') continue;
        for (const [kind, line] of [
          ['call', 'DB_PASSWORD= cfg.get(a' + x + y + 'pwd:hunter2)'],
          ['reference', 'JWT_SECRET=$' + '{X?a' + x + y + 'pwd:hunter2}'],
        ]) {
          if (redactSecrets(line).includes('hunter2')) missed.push(kind + ' ' + x + y);
        }
      }
    }
    expect(missed).toEqual([]);
  });
  // Round 16: a name read through a joiner its run start does not know goes quadratic, and when the joiner keeps the
  // credential word last (`a>-pwd`) every line still masks — rounds 12 to 16 each found such versions passing every
  // example (three-character joiners such as `?->` mostly leak, but no line here holds one). So the name, its run start
  // and the inner value are pinned as written: the timing rows above and these loops were measured against exactly
  // these. Changing one means re-measuring those (release note, rounds 12 to 16).
  it('the inner name, its run start and the inner value are the patterns the rows above were measured against', () => {
    const source = readFileSync(new URL('../src/history.ts', import.meta.url), 'utf8').split(/\r?\n/);
    const declared = (name: string) => source.find((l) => l.startsWith('const ' + name + ' = '));
    expect(declared('HEAD_INSIDE')).toBe(String.raw`const HEAD_INSIDE = /(["']?)(?<![\w.-])(-{0,2}[A-Za-z_][\w.-]*)\1(\s*[=:]\s*)/g;`);
    expect(declared('INNER_VALUE')).toBe(String.raw`const INNER_VALUE = /[^\s"',}]{1,64}/y;`);
    expect(declared('INNER_VALUE_MAX')).toBe('const INNER_VALUE_MAX = 64;');
  });
  // Round 17: the same wrong versions put into the top-level head (`ASSIGNMENT_HEAD`, `HEAD_AT`), a second declaration
  // that shadows a pinned one, a loop over another regex, or a smaller `REREAD_BELOW` passed every test — the pins
  // above read three lines, not what runs. history.ts has not changed since round 8 (833052f) and every review since
  // measured it as a whole, so the whole file is pinned as reviewed (line endings folded).
  it('history.ts is the file the reviews measured', () => {
    const source = readFileSync(new URL('../src/history.ts', import.meta.url), 'utf8').split('\r\n').join('\n');
    expect(createHash('sha256').update(source).digest('hex'), 'src/history.ts changed (any byte — a BOM, a comment, a '
      + 'trailing newline). The redactor runs on every prompt: time 128,000-character lines of every joiner and run '
      + 'start, compare against the v0.2.35 floor, and throw mutants at the change as the v0.2.36 pre-merge review did '
      + '(docs/releases/v0.2.36-review.md) — then put the new hash here.')
      .toBe('8d49b7a9e5b35a463a515ed24965a0adc80edcc5d8f7a84a2f06a483c8533c62');
  });
  // Round 18: a history.js beside it is what vitest and esbuild load, and the pin above reads a path — a transpiled copy
  // that cut before it redacted passed every test with the pin green. Nothing in src or test is JavaScript — round 19:
  // the same shadow beside the frozen v0.2.35 fixture made the floor vacuous, and `history.JS` loads on win32.
  it('src and test hold no JavaScript that could stand in for a TypeScript module', () => {
    const js = (dir: string): string[] => readdirSync(new URL(dir, import.meta.url), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? js(dir + e.name + '/') : /\.[cm]?jsx?$/i.test(e.name) ? [dir + e.name] : []);
    expect([...js('../src/'), ...js('./')]).toEqual([]);
  });
});

// Round 18 of the pre-merge review (2026-09-27): with history.ts pinned whole, the order of the preview — fold the
// whitespace, redact the WHOLE prompt, then cut to 200 — and the callers that hand it the prompt were held only by
// the hash. A version that cut first and redacted the cut text passed every other test and left the part of a secret
// before character 200 in the row: 9 of 18 characters of a password, 14 of 30 of an xAI key, 43 of 69 of a JWT (a
// caller that cut the prompt before recording it also left 15 of 15 of a URL password). One that redacted before
// folding left a whole key block whose BEGIN marker held a tab. Round 19 found more that passed these: cutting first
// only in a long text, cutting at 256 before redacting (earlier masks then pull a cut secret inside 200), folding ASCII
// whitespace only (a no-break space in the marker) — and the URL row could not fail at all (the pad's own last space
// doubled, the fold pulled the `@` inside the cut). These hold the order for these shapes; the hash holds the rest (the
// call sites: server-tools).
describe('A37 pre-merge review, rounds 18 and 19 — the preview is cut after the whole prompt is redacted', () => {
  // Exactly n characters, single spaces only — nothing for the fold to shorten.
  const pad = (n: number) => 'Refactor the loader module and keep the tests green '.repeat(8).slice(0, n - 2) + 'x ';
  const shows = (out: string, secret: string) => {
    for (let i = 0; i + 6 <= secret.length; i++) if (out.includes(secret.slice(i, i + 6))) return true;
    return false;
  };
  const row = (prompt: string) => buildHistoryEntry({ prompt, cwd: '/p' }, completed, meta).promptPreview;
  const cases = [
    ['a password', 'Xk9mQ2vR7tLpW4nB8c', (s: string) => pad(181) + 'password: ' + s + ' then deploy'],
    ['a URL password', 'S3cr3tPassw0rdZ', (s: string) => pad(175) + 'postgres://app:' + s + '@db.internal:5432/prod'],
    ['an xAI key', 'xai-' + 'AbCdEf0123456789GhIjKl0123', (s: string) => pad(186) + s],
    ['a JWT', 'eyJ' + 'hbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlMTIzNDU2', (s: string) => pad(150) + 'cookie=' + s],
  ] as const;
  it.each(cases.flatMap(([label, secret, line]) => [
    [label, '', secret, line], [label, ', in a long prompt', secret, (s: string) => line(s) + ' and more'.repeat(250)],
  ] as const))('%s across character 200%s shows none of itself', (_label, _long, secret, line) => {
    const out = row(line(secret));
    expect(out.length).toBeLessThanOrEqual(201);
    expect(shows(out, secret), out).toBe(false);
  });
  // Three masked values before it shorten the text by 63: a cut made before redacting leaves this value's first nine
  // characters, which then sit inside 200.
  it('a secret cut before redacting cannot slide into the preview behind earlier masks', () => {
    const early = ['Qw3rTy8uI0pAs5dF7gH2jK4lZx6cV9b', 'Mn8bV5cX2zL0kJ7hG4fD1sA9pO6iU3y', 'Rt5yU8iO2pA6sD9fG3hJ7kL1zX4cV0b']
      .map((v) => 'password: ' + v + ' ').join('');
    const secret = 'Xk9mQ2vR7tLpW4nB8c';
    const line = early + pad(247 - early.length - 10) + 'password: ' + secret + ' then deploy';
    expect(line.indexOf(secret)).toBe(247);
    expect(shows(row(line), secret)).toBe(false);
  });
  it('a key block whose BEGIN marker holds a tab, a newline or a no-break space is masked', () => {
    const body = 'MIIEpAIBAAKCAQEA7xK2pQ9zL4mN8rVshY';
    for (const gap of ['\t', '\n', String.fromCharCode(0xa0)]) {
      const block = '-----BEGIN RSA' + gap + 'PRIVATE KEY-----\n' + body + '\n-----END RSA PRIVATE KEY-----';
      expect(row('fix auth: ' + block)).not.toContain(body);
    }
  });
});
