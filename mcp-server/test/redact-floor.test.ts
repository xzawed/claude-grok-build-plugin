import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../src/history.js';
import { redactSecretsV0235 } from './fixtures/redact-v0.2.35.js';

// The floor (v0.2.36 pre-merge review, round 3): whatever v0.2.35 masked, v0.2.36 masks too. The A37
// rewrite reads far more names, and three review rounds found that each refinement meant to leave
// ordinary text alone also left secrets the old rule had caught — so the old pipeline now runs in its
// own order, with its own matches, and the new rule may only add masks. This test holds that line
// against the frozen v0.2.35 redactor (fixtures/redact-v0.2.35.ts), so tuning a helper both share —
// `looksLikeSecretValue`, the named keys — cannot weaken it silently.
//
// "Shown" is measured on 4-character windows of the input's alphanumeric runs: a window that occurs
// more often in v0.2.36's output than in v0.2.35's is text the old redactor hid and the new one shows.
// Windows catch partial reveals — a user and host left around a masked URL password.

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
      if (shownAgain(line).length > 0) failures.push(line);
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });
});
