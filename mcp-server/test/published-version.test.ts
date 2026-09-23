/**
 * Contract for the published-version lookup (`scripts/published-version.mjs`), the half of
 * contract drift that asks what a NEW install would get.
 *
 * WHY THIS EXISTS — MEASURED 2026-09-23. `npm run probe:contract` answered `drifted: false` while
 * `https://x.ai/cli/stable` served 1.0.41 and both this machine and the committed snapshot sat at
 * 1.0.30. Every word of that report was true, and a reader could still come away believing the
 * contract describes the CLI users receive. Grok was asked whether the probe's header overclaims
 * and answered HEADER_IS_SCOPED — it does not. The gap was that nobody asked the second question.
 *
 * The branch these tests exist for is the one a green run never reaches: "could not ask". A
 * network lookup that fails must not be readable as "you are current" — `check-release-tag.mjs`
 * collapsed exactly that distinction (b721433) and reported a cause it had never established.
 */
import { describe, it, expect } from 'vitest';
import {
  latestPublishedVersion, isSnapshotBehind, semverOf, behindLatestNote,
  SEMVER_ONLY, CHANNEL_POINTERS,
} from '../scripts/published-version.mjs';

const ok = (body: string) => ({ ok: true, status: 200, text: async () => body });
const status = (code: number) => ({ ok: false, status: code, text: async () => '' });

describe('semverOf', () => {
  it('pulls the version out of a real --version line', () => {
    // Verbatim from `grok --version` on the dev machine, 2026-09-23.
    expect(semverOf('grok 1.0.30 (04b7ffed98c6) [stable]')).toBe('1.0.30');
  });
  it('keeps a prerelease suffix, which the installer also accepts', () => {
    expect(semverOf('grok 1.1.0-rc.2 (abc) [alpha]')).toBe('1.1.0-rc.2');
  });
  it('returns null rather than guessing when there is no version', () => {
    expect(semverOf('(unreadable — the required flag was rejected)')).toBeNull();
    expect(semverOf('')).toBeNull();
  });
});

describe('SEMVER_ONLY matches what install.sh accepts', () => {
  it('accepts what the channel pointer actually served', () => {
    expect(SEMVER_ONLY.test('1.0.41')).toBe(true);
  });
  it('rejects an HTML error page served with 200 — the Cloudflare-challenge shape', () => {
    expect(SEMVER_ONLY.test('<!DOCTYPE html>')).toBe(false);
  });
  it('rejects a decorated version line, so only the bare pointer value passes', () => {
    expect(SEMVER_ONLY.test('grok 1.0.41 [stable]')).toBe(false);
  });
});

describe('latestPublishedVersion', () => {
  it('reads the first line of the channel pointer, like install.sh does', async () => {
    const r = await latestPublishedVersion('stable', async () => ok('1.0.41\n'));
    expect(r.version).toBe('1.0.41');
    expect(r.source).toBe('https://x.ai/cli/stable');
  });

  it('honours GROK_CHANNEL-style channels rather than hardcoding stable', async () => {
    let asked = '';
    await latestPublishedVersion('alpha', async (url: string) => (asked = url, ok('1.2.0-rc.1')));
    expect(asked).toBe('https://x.ai/cli/alpha');
  });

  it('falls back to GCS when the primary is unreachable, as install.sh does', async () => {
    const r = await latestPublishedVersion('stable', async (url: string) => {
      if (url.startsWith(CHANNEL_POINTERS[0])) throw new Error('getaddrinfo ENOTFOUND x.ai');
      return ok('1.0.41');
    });
    expect(r.version).toBe('1.0.41');
    expect(r.source).toBe(`${CHANNEL_POINTERS[1]}/stable`);
  });

  // The whole reason this module was split out of the probe.
  it('says it could not ask — and why — instead of returning a reassuring answer', async () => {
    const r = await latestPublishedVersion('stable', async () => { throw new Error('fetch failed'); });
    expect(r.version).toBeNull();
    expect(r.reason).toContain('could not ask');
    expect(r.reason).toContain('fetch failed');
    // Both pointers named, so the reader can tell a DNS problem from a dead endpoint.
    expect(r.reason).toContain(CHANNEL_POINTERS[0]);
    expect(r.reason).toContain(CHANNEL_POINTERS[1]);
  });

  it('treats a 200 that is not a version as a failure, not as a version', async () => {
    const r = await latestPublishedVersion('stable', async () => ok('<!DOCTYPE html>\n<html>'));
    expect(r.version).toBeNull();
    expect(r.reason).toContain('not a version string');
  });

  it('reports the HTTP status when the pointer 404s', async () => {
    const r = await latestPublishedVersion('stable', async () => status(404));
    expect(r.version).toBeNull();
    expect(r.reason).toContain('HTTP 404');
  });
});

describe('isSnapshotBehind — three states, never two', () => {
  it('true when the snapshot is older than what a new install gets (the measured case)', () => {
    expect(isSnapshotBehind('grok 1.0.30 (04b7ffed98c6) [stable]', { version: '1.0.41' })).toBe(true);
  });

  it('false only when both numbers are known and equal', () => {
    expect(isSnapshotBehind('grok 1.0.41 (x) [stable]', { version: '1.0.41' })).toBe(false);
  });

  // b721433 in one assertion: an unanswered question must not read as a reassuring answer.
  it('null — not false — when the lookup could not be performed', () => {
    expect(isSnapshotBehind('grok 1.0.30 (x) [stable]', { version: null, reason: 'could not ask: …' })).toBeNull();
    expect(isSnapshotBehind('grok 1.0.30 (x) [stable]', null)).toBeNull();
  });

  it('null when the snapshot itself has no readable version', () => {
    expect(isSnapshotBehind('(unreadable — the required flag was rejected)', { version: '1.0.41' })).toBeNull();
  });
});

/**
 * The note builder lives in this module, not in the probe, because its first draft shipped a
 * FALSE sentence and nothing could have caught it — the probe does its work at import time, so no
 * test can reach the branch selection. It printed "nothing on this machine moved" unconditionally
 * whenever the snapshot was behind the published version, which is wrong in precisely the case
 * where the machine HAS updated — the same case where the drift report above it fires, so the two
 * blocks contradicted each other. Grok, shown that scenario and that sentence alone, returned
 * SENTENCE_FALSE.
 */
describe('behindLatestNote', () => {
  const latest = { version: '1.0.41', source: 'https://x.ai/cli/stable' };
  const args = (snapshot: string, installed: string) => ({
    behind: true, channel: 'stable', latest,
    snapshotVersionLine: snapshot, installedVersionLine: installed,
  });

  it('does not claim the machine stood still when it moved (the shipped-false sentence)', () => {
    const text = behindLatestNote(args('grok 1.0.30 (x) [stable]', 'grok 1.0.41 (y) [stable]')).join(' ');
    expect(text).not.toMatch(/did not move/);
    expect(text).toMatch(/this machine moved to 1\.0\.41/);
  });

  it('says the machine stood still only when it actually did', () => {
    const text = behindLatestNote(args('grok 1.0.30 (x) [stable]', 'grok 1.0.30 (x) [stable]')).join(' ');
    expect(text).toMatch(/did not move/);
    expect(text).toMatch(/still on 1\.0\.30/);
    expect(text).not.toMatch(/machine moved to/);
  });

  it('names the channel and the source it actually read, not a hardcoded one', () => {
    const text = behindLatestNote({
      ...args('grok 1.0.30 (x) [alpha]', 'grok 1.0.30 (x) [alpha]'),
      channel: 'alpha',
      latest: { version: '1.2.0-rc.1', source: 'https://x.ai/cli/alpha' },
    }).join(' ');
    expect(text).toContain('alpha channel publishes 1.2.0-rc.1');
    expect(text).toContain('https://x.ai/cli/alpha');
  });

  it('carries the reason when the lookup could not be made, and never says up to date', () => {
    const text = behindLatestNote({
      behind: null, channel: 'stable',
      snapshotVersionLine: 'grok 1.0.30 (x) [stable]', installedVersionLine: 'grok 1.0.30 (x) [stable]',
      latest: { version: null, reason: 'could not ask: https://x.ai/cli/stable -> fetch failed' },
    }).join(' ');
    expect(text).toContain('fetch failed');
    // The phrase "up to date" may appear ONLY inside the warning against reading it that way.
    expect(text).toContain('This is "did not ask", not "up to date" — do not read it as either.');
    expect(text).not.toMatch(/snapshot \(/); // no comparison is claimed when none was made
  });

  it('says nothing at all when the snapshot matches what a new install gets', () => {
    expect(behindLatestNote({
      behind: false, channel: 'stable', latest,
      snapshotVersionLine: 'grok 1.0.41 (x) [stable]', installedVersionLine: 'grok 1.0.41 (x) [stable]',
    })).toEqual([]);
  });
});
