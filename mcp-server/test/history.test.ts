import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, statSync } from 'node:fs';
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

  // Grok's 16th PROSE line, `postgres://user:password@host:5432/db`, is masked on purpose: the URL
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
  it.each([
    ['a.a.a… (URL scheme)', 'a.'.repeat(32_000)],
    ['a-a-a…', 'a-'.repeat(32_000)],
    ['eyJ-eyJ-… (JWT)', 'eyJ-'.repeat(16_000)],
    ['xai-xai-…', 'xai-'.repeat(16_000)],
    // 8,000 markers: the old lazy scan took 47 ms at 2,000 — inside the bound, so the test could not
    // fail — and 862 ms at 8,000 (measured 2026-09-25 against 418c1e9; the fix takes 1 ms).
    ['BEGIN markers with no END', '-----BEGIN RSA PRIVATE KEY-----'.repeat(8_000)],
    ['a credential name, then 64,000 spaces', `password${' '.repeat(64_000)}x`],
    ['one 64,000-char identifier with no =', 'a'.repeat(64_000)],
    ['64,000 chars of name.name.name…', 'db.'.repeat(21_000)],
    ['64,000 chars of k=k=k…', 'k='.repeat(32_000)],
  ])('%s', (_label, input) => {
    const t0 = performance.now();
    redactSecrets(input);
    expect(performance.now() - t0).toBeLessThan(250);
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
// (418c1e9) on the same lines. Every line below is one it MEASURED: a secret the old redactor masked
// and the rewrite wrote verbatim, a line the rewrite made quadratic, or text the rewrite's mask took
// with it. Values are assembled at runtime where they look like a provider's token (see the A6 note).
describe('A37/A43 pre-merge review — what the rewrite lost against the redactor it replaced', () => {
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
    'sessionToken: randomUUID4()', 'API_TOKEN: Optional[str] = None', 'DB_PASSWORD: str | None = None',
    'DB_PASSWORD: SecretStr', 'DATABASE_URL: z.string().url()',
    "const refreshToken = crypto.randomBytes(32).toString('hex')",
    // An empty value: once whitespace is collapsed, the next line's assignment follows it.
    'DB_PASSWORD= DB_HOST=localhost DB_PORT=5432', 'JWT_SECRET= JWT_EXPIRES_IN=3600s',
  ])('leaves alone: %s', (line) => {
    expect(redactSecrets(line)).toBe(line);
  });

  it.each([
    ['set `DB_PASSWORD=hunter2` in .env', 'set `DB_PASSWORD=<redacted>` in .env'],
    ['Use DB_PASSWORD=hunter2.', 'Use DB_PASSWORD=<redacted>.'],
    ['(DB_PASSWORD=hunter2) then restart', '(DB_PASSWORD=<redacted>) then restart'],
    ['[DB_PASSWORD=hunter2]', '[DB_PASSWORD=<redacted>]'],
    ['DB_PASSWORD=hunter2; npm start', 'DB_PASSWORD=<redacted>; npm start'],
    [`password: ${V}. Then deploy`, 'password: <redacted>. Then deploy'],
  ])('masks the value and keeps what closes around it: %s', (line, expected) => {
    expect(redactSecrets(line)).toBe(expected);
  });

  // The chains the review timed: `pwd=${…` took 268 ms at 64,000 chars, 1.0 s at 128,000 and 17.4 s at
  // 512,000 — every head re-read the rest of the run, because a skipped value was not consumed. 128,000
  // here, so a fast machine cannot pass the quadratic version under the bound.
  it.each([
    ['pwd=${ chain', 'pwd=$' + '{'],
    ['DB_PASSWORD=${ chain', 'DB_PASSWORD=$' + '{'],
    ['token:${ chain', 'token:$' + '{'],
    ['A_PASSWORD=${A_PASSWORD:- chain', 'A_PASSWORD=$' + '{A_PASSWORD:-'],
    ['password=f( chain', 'password=f('],
    ['DB_PASSWORD= NAME= chain', 'DB_PASSWORD= '],
  ])('%s stays linear', (_label, unit) => {
    const input = unit.repeat(Math.ceil(128_000 / unit.length));
    const t0 = performance.now();
    redactSecrets(input);
    expect(performance.now() - t0).toBeLessThan(250);
  });
});
