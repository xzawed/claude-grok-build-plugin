/**
 * Release/handoff drift guard: a shipped version must come with release notes, and the
 * live handoff docs must advertise that same version.
 *
 * Deliberately NOT asserted: version strings inside docs/06-roadmap.md and
 * docs/00-product-vision.md. Those are historical narrative — pinning them would force a
 * doc edit on every unrelated patch bump and the test would end up hated and disabled.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

function shippedVersion(): string {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'mcp-server/package.json'), 'utf8')) as {
    version: string;
  };
  return pkg.version;
}

// MEASURED 2026-09-22, while cutting v0.2.26: CONTRIBUTING.md "Release" lists three sites that
// carry the version with "no test behind them", and says "this list is the only thing that
// catches them". It did not. All three were already stale before this release touched them:
//   mcp-server/package-lock.json  0.2.24  (missed by v0.2.25 as well — two releases behind)
//   docs/03-plugin-spec.md        0.2.23  (three releases behind)
// A checklist a human has to re-read every time is not a guard; it is a thing that gets skipped.
// These are cheap to assert, so assert them.
//
// The lockfile matters beyond tidiness: `npm ci` rebuilds the tree from it, and the committed
// esbuild bundles inline runtime dependencies, so it is the file that decides what a fresh
// installer actually gets.
describe('version sites CONTRIBUTING lists but nothing enforced', () => {
  it('package-lock.json carries the shipped version in both places', () => {
    const version = shippedVersion();
    const lock = JSON.parse(readFileSync(join(repoRoot, 'mcp-server/package-lock.json'), 'utf8')) as {
      version: string;
      packages: Record<string, { version?: string }>;
    };
    expect(lock.version, 'package-lock.json root version drifted from package.json').toBe(version);
    expect(lock.packages[''].version, 'package-lock.json packages[""] version drifted').toBe(version);
  });

  it('docs/03-plugin-spec.md embeds the shipped version in its plugin.json example', () => {
    const version = shippedVersion();
    const text = readFileSync(join(repoRoot, 'docs/03-plugin-spec.md'), 'utf8');
    expect(
      text.includes(`"version": "${version}"`),
      `docs/03-plugin-spec.md shows a plugin.json example whose version is not ${version} — `
      + 'it is the spec readers copy from, so a stale literal there teaches the wrong manifest',
    ).toBe(true);
  });

  it('CHANGELOG.md names the shipped version', () => {
    const version = shippedVersion();
    const text = readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8');
    expect(
      text.includes(`v${version}`),
      `CHANGELOG.md has no v${version} entry — it is the history SSOT this repo points every `
      + 'other doc at, so shipping without one leaves the narrative with a hole',
    ).toBe(true);
  });
});

describe('handoff version', () => {
  it('release notes exist for the shipped version', () => {
    const version = shippedVersion();
    const notes = join(repoRoot, `docs/releases/v${version}.md`);
    expect(
      existsSync(notes),
      `missing docs/releases/v${version}.md — write release notes before shipping`,
    ).toBe(true);
  });

  // `gh release create --notes-file` sends the file as checked out — with CRLF on Windows, and published bodies keep
  // their CRs — and GitHub refuses a body over 125,000 characters. Our procedure pushes the tag first, so a refusal
  // leaves a tag with no release (round 27 of the v0.2.36 pre-merge review: those notes were 125,280 as checked out).
  // Code points plus one per line is the CRLF worst case. A long record moved out must be linked by an absolute URL:
  // a release page resolves relative links against the repository root.
  it('release notes fit a GitHub release body', () => {
    const version = shippedVersion();
    const text = readFileSync(join(repoRoot, `docs/releases/v${version}.md`), 'utf8').split('\r\n').join('\n');
    const worst = [...text].length + text.split('\n').length - 1;
    expect(worst, `docs/releases/v${version}.md is ${worst} characters with CRLF line endings — over GitHub's 125,000 `
      + 'for a release body. Move the long record into its own file and link it by an absolute URL, as the v0.2.36 notes '
      + 'do for docs/releases/v0.2.36-review.md.')
      .toBeLessThanOrEqual(125_000);
  });

  it('CLAUDE.md advertises the shipped version', () => {
    const version = shippedVersion();
    const text = readFileSync(join(repoRoot, 'CLAUDE.md'), 'utf8');
    expect(text.includes(version), `CLAUDE.md 현재 상태 must cite ${version}`).toBe(true);
  });

  it('the last-resort fallback in src/version.ts matches package.json', () => {
    // smoke.test.ts only covers the happy path (package.json readable). The hardcoded
    // fallback is what ships when packaging omits package.json, and nothing else pins it.
    const version = shippedVersion();
    const src = readFileSync(join(repoRoot, 'mcp-server/src/version.ts'), 'utf8');
    const m = /return '(\d+\.\d+\.\d+)';/.exec(src);
    expect(m, 'could not find the fallback literal in src/version.ts').not.toBeNull();
    expect(m![1], 'src/version.ts fallback drifted from package.json').toBe(version);
  });

  it('docs/09 advertises the shipped version', () => {
    const version = shippedVersion();
    const text = readFileSync(join(repoRoot, 'docs/09-scope-and-residuals.md'), 'utf8');
    expect(text.includes(version), `docs/09 ship line must cite ${version}`).toBe(true);
  });
});
