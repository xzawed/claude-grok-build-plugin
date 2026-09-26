import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../src/history.js';
import { redactSecretsV0235 } from './fixtures/redact-v0.2.35.js';

// The floor (v0.2.36 pre-merge review, round 3): whatever v0.2.35 masked, v0.2.36 masks too. The A37
// rewrite reads far more names, and three review rounds found that each refinement meant to leave
// ordinary text alone also left secrets the old rule had caught — so the old pipeline now runs in its
// own order, with its own matches, and the new rule may only add masks. This test holds that line
// against the frozen v0.2.35 redactor (fixtures/redact-v0.2.35.ts), so tuning a helper both share —
// `looksLikeSecretValue`, the named keys — cannot weaken it silently. (Round 4 found that the named keys
// were NOT guarded: a copy without five of them passed every test. They have their own test below.)
//
// "Shown" is measured two ways. On 4-character windows of the input's alphanumeric runs: a window that
// occurs more often in v0.2.36's output than in v0.2.35's is text the old redactor hid and the new one
// shows — windows catch partial reveals, a user and host left around a masked URL password. And by
// position (hiddenBy, below), which also sees a one-character reveal whose place is certain. Neither sees
// a revealed character that also occurs elsewhere inside the same masked value — its place is ambiguous
// (round 5 planted such a floor, and only an exact-output test failed).

const strip = (s: string) => s.split('<redacted>').join('#');
function windows(s: string): Set<string> {
  const w = new Set<string>();
  for (const run of s.match(/[A-Za-z0-9]{4,}/g) ?? []) for (let i = 0; i + 4 <= run.length; i++) w.add(run.slice(i, i + 4));
  return w;
}
const count = (hay: string, needle: string) => {
  let c = 0;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) c++;
  return c;
};
/** Text v0.2.35 hid that v0.2.36 shows. */
function shownAgain(line: string): string[] {
  const old = strip(redactSecretsV0235(line));
  const now = strip(redactSecrets(line));
  return [...windows(line)].filter((w) => count(now, w) > count(old, w));
}

// Windows cannot see a reveal shorter than 4 characters: the round-4 review planted a floor that showed each
// value's first character, and one that left its last three, and both passed 30,000 lines here. So the same
// lines are also checked by POSITION. An output is its input with non-empty spans replaced by the mask, so
// its literal pieces sit in the input in order, at least one character apart; each piece has an earliest and
// a latest place. A position between the latest end of one piece and the earliest start of the next is
// hidden in every placement (`sure`); one between the earliest end and the latest start, in some (`maybe`).
// Exact when the placement is unique, and never a false alarm when it is not.
const MARK = '<redacted>';
interface Hidden { sure: Uint8Array; maybe: Uint8Array }
function hiddenBy(s: string, out: string): Hidden | undefined {
  const lit = out.split(MARK);
  const k = lit.length - 1;
  const sure = new Uint8Array(s.length);
  const maybe = new Uint8Array(s.length);
  if (k === 0) return out === s ? { sure, maybe } : undefined;
  if (!s.startsWith(lit[0]) || !s.endsWith(lit[k])) return undefined;
  const early = [0];
  let end = lit[0].length;
  for (let i = 1; i <= k; i++) {
    const at = i === k ? s.length - lit[k].length : s.indexOf(lit[i], end + 1);
    if (at < end + 1) return undefined;
    early.push(at);
    end = at + lit[i].length;
  }
  const late = [...early];
  for (let i = k - 1; i >= 1; i--) {
    const at = s.lastIndexOf(lit[i], late[i + 1] - 1 - lit[i].length);
    if (at < early[i]) return undefined;
    late[i] = at;
  }
  for (let i = 1; i <= k; i++) {
    for (let p = late[i - 1] + lit[i - 1].length; p < early[i]; p++) sure[p] = 1;
    for (let p = early[i - 1] + lit[i - 1].length; p < late[i]; p++) maybe[p] = 1;
  }
  return { sure, maybe };
}
/** Positions v0.2.35 surely hid that v0.2.36 surely shows; `undefined` if an output is not a masking of the input. */
function shownAt(line: string): number[] | undefined {
  const old = hiddenBy(line, redactSecretsV0235(line));
  const now = hiddenBy(line, redactSecrets(line));
  if (!old || !now) return undefined;
  const shown: number[] = [];
  for (let p = 0; p < line.length; p++) if (old.sure[p] && !now.maybe[p]) shown.push(p);
  return shown;
}

describe('the v0.2.35 floor', () => {
  // The lines the round-3 review shrank its violations to: each needs a URL or a key block, because
  // the first linear rewrites of those two rules changed the text the assignment rule then read.
  it.each([
    'password: my_db://app:pw1@dbhost',
    '://:CONNECTION_STRING=@iand',
    'secret=Swordfish-----BEGIN PRIVATE KEY----- a -----BEGIN CERTIFICATE----- b -----END PRIVATE KEY-----2024',
    'secret=Tiger-----BEGIN RSA PRIVATE KEY----- a -----BEGIN CERTIFICATE----- b -----END RSA PRIVATE KEY-----99',
  ])('shows nothing v0.2.35 hid: %s', (line) => {
    expect(shownAgain(line)).toEqual([]);
    expect(shownAt(line)).toEqual([]);
  });

  // Every name v0.2.35 read as a named key — its value masked whatever it looks like, `hunter2` and
  // `enabled` included (the new rule alone keeps `enabled`: a flag). Read from the frozen fixture's own
  // source, so the list cannot drift from it.
  const fixtureSource = readFileSync(new URL('./fixtures/redact-v0.2.35.ts', import.meta.url), 'utf8');
  const namedStatement = /const NAMED_KEYS =([^;]*);/.exec(fixtureSource)?.[1] ?? '';
  const namedKeys = [...namedStatement.matchAll(/'([^']*)'/g)].map((m) => m[1]).join('').split('|');
  it('reads all of v0.2.35\'s named keys from the fixture', () => {
    expect(namedKeys).toHaveLength(18);
    expect(namedKeys).toContain('POSTGRES_URL');
  });
  const namedValues = ['hunter2', 'enabled', 'postgresql://db.internal/app?user=app&password=hunter2', 'Server=db;Uid=sa;Pwd=hunter2'];
  it.each(namedKeys)('masks what v0.2.35 masked after %s', (key) => {
    for (const name of [key, key.toLowerCase()]) {
      for (const value of namedValues) {
        for (const line of [`${name}=${value}`, `${name}: ${value}`, `"${name}": "${value}"`, `export ${name}='${value}'`]) {
          expect(redactSecretsV0235(line), line).not.toContain(value);
          expect(redactSecrets(line), line).not.toContain(value);
          expect(shownAgain(line), line).toEqual([]);
          expect(shownAt(line), line).toEqual([]);
        }
      }
    }
  });

  // Generated lines on every rule's boundary — URL schemes well- and ill-formed, key markers glued to
  // values, Bearer/Basic, JWT pieces, vendor prefixes, placeholders, calls, quotes and closers — built
  // as `name sep value` clauses, the shape the review found its violations in. Seeded, so a failure
  // reproduces; each failing line is printed.
  it('shows nothing v0.2.35 hid, over 30,000 generated lines', () => {
    let seed = 20260925;
    const rnd = (n: number) => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) % n;
    };
    const pick = <T,>(a: readonly T[]) => a[rnd(a.length)];
    const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const run = (n: number) => { let s = ''; for (let i = 0; i < n; i++) s += ALNUM[rnd(ALNUM.length)]; return s; };
    const FRAG: Record<string, readonly string[]> = {
      name: ['password', 'PASSWORD', 'PassWord', 'api-key', 'API_KEY', 'apikey', 'access_token', 'client_secret',
        'pwd', 'secret', 'passwd', 'private_key', 'auth_token', 'GITHUB_TOKEN', 'DATABASE_URL', 'CONNECTION_STRING',
        'DB_URL', 'DB_PASSWORD', 'dbPassword', 'env.DB_PASSWORD', 'x.password', '--password', 'db-password',
        'passphrase', 'token', 'SMTP_PASS', 'MAX_TOKEN', 'apiToken', 'client-secret'],
      sep: ['=', ':', ' = ', ': ', ':=', '=='],
      quote: ['"', "'", '`'],
      url: ['://', '@', ':', '/', 'postgres://', 'https://', 'my_db://', '_://', '1://', 'a_b://', 'redis://:', 'x+y://'],
      pem: ['-----BEGIN RSA PRIVATE KEY-----', '-----END RSA PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----',
        '-----END PRIVATE KEY-----', '-----BEGIN CERTIFICATE-----', '-----BEGIN ', '-----END CERTIFICATE-----'],
      auth: ['Bearer ', 'Basic ', 'bearer '],
      jwt: ['eyJ', '.', '-', 'eyJhbGciOiJIUzI1NiJ9', '.eyJzdWIiOiIxMjM0In0', '.c2lnbmF0dXJlMTIzNA'],
      vendor: ['xai-', 'sk-', 'ghp_', 'AKIA', 'sk_live_', 'AIza', 'npm_', 'xoxb-', 'github_pat_'],
      ref: ['$', '${', '}', '%', '<', '>', 'your-', ':-', 'f(', ')', '[', ']'],
      punct: [';', ',', '&', '(', ')', '{', '}', '.', '-', '_', ' ', ' ', '|', '?', '#', '!'],
    };
    const VALUE = ['run', 'run', 'run', 'url', 'url', 'url', 'pem', 'pem', 'jwt', 'auth', 'vendor', 'ref', 'punct', 'name', 'sep'];
    const frag = (kind: string) => (kind === 'run' ? run(1 + rnd(24)) : pick(FRAG[kind]));
    const clauseLine = () => {
      let line = '';
      for (let c = 1 + rnd(4); c > 0; c--) {
        if (rnd(3) === 0) line += frag(pick(['punct', 'run', 'auth', 'jwt', 'url']));
        const q = rnd(4) === 0 ? pick(FRAG.quote) : '';
        line += frag('name') + frag('sep') + q;
        for (let k = 1 + rnd(6); k > 0; k--) line += frag(pick(VALUE));
        line += q + pick([' ', ' ', ';', ',', '&', ' and ', '. ', ') ', '} ']);
      }
      return line;
    };
    const soupLine = () => {
      let line = '';
      for (let k = 3 + rnd(13); k > 0; k--) line += frag(pick([...Object.keys(FRAG), 'run']));
      return line;
    };
    const failures: string[] = [];
    for (let i = 0; i < 30_000; i++) {
      const line = i % 3 === 2 ? soupLine() : clauseLine();
      if (line.includes('redacted')) continue;
      const at = shownAt(line);
      if (at === undefined || at.length > 0 || shownAgain(line).length > 0) failures.push(line);
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });

  // Round 18: every comparison above is against the fixture, and a fixture that returned today's redactSecrets passed
  // all of them — the floor would hold nothing. It is v0.2.35's code, frozen (57 code lines verbatim from 418c1e9's
  // history.ts, and the same output over 60,000 lines — round 18), so it is pinned as frozen (line endings folded).
  it('the floor is the frozen v0.2.35 redactor', () => {
    const fixture = readFileSync(new URL('./fixtures/redact-v0.2.35.ts', import.meta.url), 'utf8').split('\r\n').join('\n');
    expect(createHash('sha256').update(fixture).digest('hex'), 'the frozen v0.2.35 redactor changed — it is the floor '
      + 'every version must keep; restore it from git (it came in 2d5ad95), do not edit it to pass').toBe('581fc3a3b3ec18584d8f584d76a786b60e73742a86877aa4657e28a44d7957e2');
  });
});
