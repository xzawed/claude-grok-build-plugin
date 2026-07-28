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

describe('handoff version', () => {
  it('release notes exist for the shipped version', () => {
    const version = shippedVersion();
    const notes = join(repoRoot, `docs/releases/v${version}.md`);
    expect(
      existsSync(notes),
      `missing docs/releases/v${version}.md — write release notes before shipping`,
    ).toBe(true);
  });

  it('CLAUDE.md advertises the shipped version', () => {
    const version = shippedVersion();
    const text = readFileSync(join(repoRoot, 'CLAUDE.md'), 'utf8');
    expect(text.includes(version), `CLAUDE.md 현재 상태 must cite ${version}`).toBe(true);
  });

  it('docs/09 advertises the shipped version', () => {
    const version = shippedVersion();
    const text = readFileSync(join(repoRoot, 'docs/09-scope-and-residuals.md'), 'utf8');
    expect(text.includes(version), `docs/09 ship line must cite ${version}`).toBe(true);
  });
});
