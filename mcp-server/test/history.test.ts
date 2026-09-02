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
