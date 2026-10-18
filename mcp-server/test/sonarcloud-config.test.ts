/**
 * `.sonarcloud.properties` steers SonarQube Cloud's automatic analysis. Its docs (read 2026-10-17): the file is added on
 * the repository's default branch, and its values take no wildcards. So it names every tracked path itself —
 * mcp-server's apart from its tests, which it declares as tests — and these checks keep that list from going stale,
 * overlapping, or narrowing what is analyzed without anyone noticing (an inclusion or exclusion key would do that and
 * pass every other check). Why the tests are declared, and the review behind it:
 * docs/specs/2026-10-17-sonarcloud-review.md. The shape it accepts is narrower than what Java reads, on purpose: one
 * `key=value` line per key, with no `:` or space separator and no backslash continuation — so the value it checks is
 * the value SonarQube reads. Each check is a function of the text, so that a row below shows it failing (round-7
 * review: checks that only ever see the real file can weaken unseen).
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const raw = readFileSync(join(repoRoot, '.sonarcloud.properties'), 'utf8');
const under = (file: string, path: string) => file === path || file.startsWith(`${path}/`);
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
  .split(String.fromCodePoint(0)).filter(Boolean);
const FROZEN = 'mcp-server/test/fixtures/redact-v0.2.35.ts';

/**
 * A properties text as the checks read it: lines end as java.util.Properties ends them — a lone CR too, or a key could
 * hide behind one inside a comment — and a key's last line wins, as in Java; each value is split on its commas.
 */
function read(text: string) {
  const entries = text.split(/\r\n|\r|\n/).filter((l) => l !== '' && !l.startsWith('#'));
  const keys = entries.map((l) => l.slice(0, l.indexOf('=')));
  const props = new Map(entries.map((l, i) => [keys[i], l.slice(l.indexOf('=') + 1)] as [string, string]));
  const list = (key: string) => (props.get(key) ?? '').split(',').filter(Boolean);
  return { entries, keys, props, sources: list('sonar.sources'), tests: list('sonar.tests'), exclusions: list('sonar.test.exclusions') };
}

/** Each check, by name, as what it finds wrong in a text — nothing when the text passes. */
const CHECKS: Record<string, [string, (text: string) => unknown[]]> = {
  ascii: ['is printable ASCII (CR and LF aside) without a BOM — a BOM would become part of the first key for a Java reader',
    (t) => [...t].filter((c) => c !== '\n' && c !== '\r' && (c < ' ' || c > '~'))],
  loneCr: ['has no lone CR — java.util.Properties ends a line there, so a key could hide inside a comment',
    (t) => t.match(/\r(?!\n)/g) ?? []],
  shape: ['holds only key=value lines, with no spaces around either side',
    (t) => read(t).entries.filter((l) => !/^[a-z.]+=\S+$/.test(l))],
  once: ['names each key once — a reader that keeps the first value would read another list',
    (t) => read(t).keys.filter((k, i, keys) => keys.indexOf(k) !== i)],
  keys: ['holds only the three keys it needs, so nothing can narrow the analysis quietly',
    (t) => {
      const keys = [...read(t).props.keys()].sort().join();
      return keys === 'sonar.sources,sonar.test.exclusions,sonar.tests' ? [] : [keys];
    }],
  wildcard: ['uses no wildcard in any value',
    (t) => [...read(t).props].filter(([, value]) => /[*?]/.test(value)).map(([key]) => key)],
  tracked: ['names only tracked paths',
    (t) => {
      const r = read(t);
      return [...r.sources, ...r.tests, ...r.exclusions].filter((p) => !tracked.some((f) => under(f, p)));
    }],
  // SonarQube 26.10, measured 2026-10-17: a file reached through two entries stops the whole analysis ("can't be
  // indexed twice", EXECUTION FAILURE) — the same path twice, a path under another, or one in both main code and tests.
  overlap: ['lists no path twice and none under another, main code and tests together',
    (t) => {
      const r = read(t);
      const all = [...r.sources, ...r.tests];
      return all.flatMap((a, i) => all.filter((b, j) => i !== j && under(a, b)).map((b) => `${a} / ${b}`));
    }],
  declared: ['declares the tests, and leaves out the frozen v0.2.35 redaction copy, which is never edited to please an analyzer',
    (t) => {
      const r = read(t);
      return r.tests.join() === 'mcp-server/test' && r.exclusions.join() === FROZEN ? [] : [r.tests, r.exclusions];
    }],
  covered: ['puts every tracked file under a source or a test entry, so only an exclusion can leave one out',
    (t) => {
      const r = read(t);
      return tracked.filter((f) => !r.sources.some((p) => under(f, p)) && !r.tests.some((p) => under(f, p)));
    }],
};

describe('.sonarcloud.properties', () => {
  it('sits in a repository of real size, so the path checks are not vacuous', () => {
    expect(tracked.length).toBeGreaterThan(200);
  });

  it.each(Object.values(CHECKS))('%s', (_name, check) => {
    expect(check(raw)).toEqual([]);
  });
});

describe('the checks themselves', () => {
  const CR = String.fromCodePoint(13);
  const BOM = String.fromCodePoint(0xfeff);
  const withLine = (extra: string) => `${raw.replace(/\r?\n$/, '')}\n${extra}\n`;

  // A row for each check, and one for each condition review found a check could lose unseen (rounds 8 to 10).
  const BREAKS: [string, string][] = [
    ['ascii', `${BOM}${raw}`],
    ['ascii', raw.replace('# SonarQube', `#${String.fromCodePoint(9)}SonarQube`)], // below the space, as above the tilde
    ['loneCr', raw.replace('# SonarQube', `# a${CR}sonar.exclusions=docs${CR}# SonarQube`)],
    ['shape', withLine('sonar.exclusions : docs')],
    ['shape', withLine(' sonar.exclusions=docs')], // something before the key
    ['shape', withLine('sonar.exclusions=docs x')], // something after the value
    ['shape', withLine('sonar.exclusions=')], // no value at all
    ['shape', withLine('=docs')], // no key at all
    ['once', withLine('sonar.tests=mcp-server/test')],
    ['keys', withLine('sonar.exclusions=docs')],
    ['keys', raw.replace('sonar.test.exclusions=', 'sonar.test.exclusion=')], // three keys, one of them misnamed
    ['keys', raw.replace('# SonarQube', `# a${CR}sonar.exclusions=docs${CR}# SonarQube`)], // a key behind a lone CR
    ['wildcard', raw.replace(FROZEN, 'mcp-server/test/fixtures/*.ts')],
    ['wildcard', raw.replace(FROZEN, 'mcp-server/test/fixtures/redact-v0.2.3?.ts')],
    ['wildcard', raw.replace(',hooks,', ',hooks*,')], // in the sources, not only the exclusions
    ['wildcard', raw.replace('sonar.tests=mcp-server/test', 'sonar.tests=mcp-server/test*')], // in the tests
    ['tracked', raw.replace(',hooks,', ',hooks,nowhere,')],
    ['tracked', raw.replace(',hooks,', ',hooks,hook,')], // a string prefix of a tracked path, but not a path
    ['tracked', raw.replace(FROZEN, 'mcp-server/test/fixtures/redact-v0.2.34.ts')], // an exclusion that is not tracked
    ['tracked', raw.replace('sonar.tests=mcp-server/test', 'sonar.tests=mcp-server/test,nowhere')], // a test entry
    ['overlap', raw.replace(',docs,', ',docs,docs/specs,')],
    ['overlap', raw.replace(',docs,', ',docs/specs,docs,')], // the path under another listed first
    ['overlap', raw.replace(',mcp-server/vitest.config.ts', ',mcp-server/vitest.config.ts,mcp-server/test')], // main and tests
    ['declared', raw.replace(`=${FROZEN}`, '=mcp-server/test/fixtures')],
    ['declared', raw.replace('sonar.tests=mcp-server/test', 'sonar.tests=mcp-server/test,mcp-server/scripts')],
    ['covered', raw.replace(',hooks,', ',')],
  ];

  it('has a row for every check', () => {
    expect([...new Set(BREAKS.map(([id]) => id))].sort()).toEqual(Object.keys(CHECKS).sort());
  });

  it.each(BREAKS)('%s fails on a text built to break it (row %#)', (id, text) => {
    expect(text).not.toBe(raw);
    expect(CHECKS[id][1](text).length).toBeGreaterThan(0);
  });
});
