/**
 * Repo-root plugin packaging surface (commands/skills/agents) — keeps first-mile
 * assets discoverable and frontmatter valid.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Frontmatter reader that understands YAML block scalars (`key: >` / `key: |`).
 *
 * The line-by-line parseFrontmatter below returns ">" for a folded value: its regex captures
 * only the rest of the `description: >` line, and the indented continuation lines never match.
 * Every SHIPPED skill/agent writes its description that way, so a length check built on that
 * helper would assert on ">" and pass no matter what the file said. Measured 2026-09-03.
 */
export function parseFrontmatterFolded(md: string): Record<string, string> {
  const text = md.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return {};
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) return {};
  const lines = text.slice(4, end).split('\n');
  const out: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const m = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const [, key, rest] = m;
    const trimmed = rest.trim();
    if (trimmed !== '>' && trimmed !== '|' && trimmed !== '>-' && trimmed !== '|-') {
      out[key] = trimmed;
      continue;
    }
    // Block scalar: consume the indented lines that follow.
    const parts: string[] = [];
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
      parts.push(lines[i + 1].trim());
      i += 1;
    }
    out[key] = parts.join(trimmed.startsWith('>') ? ' ' : '\n');
  }
  return out;
}

function parseFrontmatter(md: string): Record<string, string> {
  // Normalize CRLF (Windows checkouts) so --- fences match.
  const text = md.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return {};
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) return {};
  const block = text.slice(4, end);
  const out: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

// AUDITED BY GROK 2026-09-23. Claim put to it, over build.mjs and package.json together: "this
// project has a minimum runtime version, and the manifest does not state it." Verdict True — the
// floor was set only by the bundler's `target`, and the manifest had no `engines` field at all.
// Grok also ruled out the near-miss: `@types/node` is a devDependency range, not a runtime version.
//
// This matters more here than in an ordinary package. End users receive the BUILT files and run
// them on whatever node they already have — nothing installs dependencies at the install site, so
// no tooling ever reads `engines` on their behalf. Declaring it does not protect them; it makes the
// floor reviewable, which is the repo's own rule for where a minimum runtime lives. The protection
// is that the two numbers can no longer drift apart silently.
describe('runtime floor is stated once and agrees with the bundle', () => {
  it('package.json engines matches build.mjs target', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'mcp-server/package.json'), 'utf8')) as {
      engines?: { node?: string };
    };
    const build = readFileSync(join(repoRoot, 'mcp-server/build.mjs'), 'utf8');
    const target = /target:\s*'node(\d+)'/.exec(build)?.[1];
    expect(target, 'build.mjs no longer states a node target').toBeTruthy();
    expect(pkg.engines?.node, 'package.json declares no engines.node — the floor is unstated').toBeTruthy();
    expect(
      pkg.engines!.node!.includes(target!),
      `engines.node (${pkg.engines?.node}) and build.mjs target (node${target}) disagree`,
    ).toBe(true);
  });
});

describe('plugin surface', () => {
  it('every commands/*.md has description frontmatter', () => {
    const dir = join(repoRoot, 'commands');
    const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
    expect(files.length).toBeGreaterThanOrEqual(20);
    // First-mile + collab path commands must exist
    for (const required of [
      'setup.md', 'tour.md', 'delegate.md', 'route.md', 'resume.md', 'review.md', 'usage.md', 'status.md',
    ]) {
      expect(files).toContain(required);
    }
    for (const f of files) {
      const fm = parseFrontmatter(readFileSync(join(dir, f), 'utf8'));
      expect(fm.description, f).toBeTruthy();
      expect(fm.description.length, f).toBeGreaterThan(8);
    }
  });

  it('skills and agent definitions exist', () => {
    expect(existsSync(join(repoRoot, 'skills/grok-first-mile/SKILL.md'))).toBe(true);
    expect(existsSync(join(repoRoot, 'skills/grok-routing/SKILL.md'))).toBe(true);
    expect(existsSync(join(repoRoot, 'agents/grok-worker.md'))).toBe(true);
  });

  it('/grok:delegate states the full collaboration contract', () => {
    const text = readFileSync(join(repoRoot, 'commands/delegate.md'), 'utf8');
    for (const token of [
      'grok_build_status', 'billingMismatch', 'grok_build_route',
      'nextAction', 'worktree', '/grok:review',
    ]) {
      expect(text, `commands/delegate.md must mention ${token}`).toContain(token);
    }
  });

  // v0.2.33: the field only helps if the surfaces that print `billing` also print it. Pinned where
  // the user reads billing after a status, delegate, plan or verify call — and each must say not to
  // stop on it (the owner's decision: warn, never block). The first version listed seven files; the
  // docs review found the first-mile and preset surfaces missing, which are exactly where a new user
  // checks "subscription". Left out on purpose: usage.md (history never carries the field), route.md
  // (shows no billing) and the grok_cli commands (grok_cli is outside the feature's scope).
  it('every surface that shows billing also shows billingCaveat, without stopping on it', () => {
    for (const rel of [
      'commands/status.md', 'commands/delegate.md', 'commands/plan.md', 'commands/verify.md',
      'commands/review.md', 'commands/tour.md', 'commands/setup.md', 'commands/tests.md',
      'commands/boilerplate.md', 'commands/migrate.md', 'commands/resume.md',
      'agents/grok-worker.md', 'skills/grok-routing/SKILL.md', 'skills/grok-first-mile/SKILL.md',
    ]) {
      const text = readFileSync(join(repoRoot, rel), 'utf8');
      expect(text, `${rel} must mention billingCaveat`).toContain('billingCaveat');
      expect(text, `${rel} must say the caveat does not stop the run`).toMatch(/do not stop|not a reason to stop|without stopping/i);
    }
  });

  // A35 (v0.2.34): grok resolves a relative GROK_HOME against the folder it runs in, so a readiness
  // check answers for whatever folder it is given — none means the MCP server's own. The first
  // version of this change updated eight surfaces and missed setup, tour and the first-mile skill;
  // the docs review found them. Pinned on the FIRST line that names the tool, where the call is
  // described. status.md is left out on purpose: its `cwd` also filters the usage it shows, so it
  // shows grokHomeNote instead of narrowing the dashboard.
  it('every surface that checks readiness passes the absolute cwd it will work in', () => {
    for (const rel of [
      'commands/delegate.md', 'commands/verify.md', 'commands/tests.md', 'commands/boilerplate.md',
      'commands/migrate.md', 'commands/resume.md', 'commands/setup.md', 'commands/tour.md',
      'agents/grok-worker.md', 'skills/grok-routing/SKILL.md', 'skills/grok-first-mile/SKILL.md',
    ]) {
      const lines = readFileSync(join(repoRoot, rel), 'utf8').split('\n');
      const at = lines.findIndex((l) => l.includes('grok_build_status') || l.includes('grok_auth_check'));
      expect(at, `${rel} must call a readiness tool`).toBeGreaterThanOrEqual(0);
      expect(`${lines[at]} ${lines[at + 1] ?? ''}`, `${rel} must pass the cwd with that call`).toContain('`cwd`');
    }
    for (const rel of ['commands/status.md', 'commands/setup.md', 'commands/tour.md']) {
      expect(readFileSync(join(repoRoot, rel), 'utf8'), `${rel} must show grokHomeNote`).toContain('grokHomeNote');
    }
  });

  it('routing skill warns about the un-gated grok_cli bypass and billingMismatch', () => {
    const text = readFileSync(join(repoRoot, 'skills/grok-routing/SKILL.md'), 'utf8');
    expect(text, 'routing skill must warn about grok_cli edits').toContain('grok_cli');
    expect(text, 'routing skill must mention billingMismatch').toContain('billingMismatch');
  });

  it('internal maintainer skills live under .claude/ with valid frontmatter', () => {
    for (const name of ['repo-scope', 'maintainer-preflight']) {
      const p = join(repoRoot, '.claude/skills', name, 'SKILL.md');
      expect(existsSync(p), p).toBe(true);
      const fm = parseFrontmatter(readFileSync(p, 'utf8'));
      expect(fm.name, name).toBe(name);
      expect(fm.description, name).toBeTruthy();
      expect(fm.description.length, name).toBeGreaterThan(40);
    }
  });

  it('maintainer-preflight triggers a rebuild on lockfile changes, not just src/', () => {
    // esbuild bundles runtime deps into dist/, so a lockfile-only bump changes the
    // committed bundle (observed: PR #27). A skill keyed solely on src/** would skip it.
    const text = readFileSync(join(repoRoot, '.claude/skills/maintainer-preflight/SKILL.md'), 'utf8');
    expect(text, 'preflight must name the lockfile as a rebuild trigger').toContain('package-lock.json');
  });

  it('shipped skills/ holds only end-user skills — maintainer content belongs in .claude/', () => {
    const entries = readdirSync(join(repoRoot, 'skills'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(entries).toEqual(['grok-first-mile', 'grok-routing']);
  });

  it('plugin.json version matches mcp-server/package.json', () => {
    const plugin = JSON.parse(readFileSync(join(repoRoot, '.claude-plugin/plugin.json'), 'utf8')) as {
      version: string;
    };
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'mcp-server/package.json'), 'utf8')) as {
      version: string;
    };
    expect(plugin.version).toBe(pkg.version);
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  // ── Audit 3, 2026-09-03. The three SHIPPED surface files were checked by existsSync alone,
  // while the two internal .claude/ skills got name + description validation. The gap was not
  // an oversight about which files matter — it is that all three shipped files use a folded
  // scalar, which the original helper cannot read.
  it('shipped skills and agent carry real name/description frontmatter', () => {
    const surface = [
      ['skills/grok-first-mile/SKILL.md', 'grok-first-mile'],
      ['skills/grok-routing/SKILL.md', 'grok-routing'],
      ['agents/grok-worker.md', 'grok-worker'],
    ] as const;
    for (const [rel, name] of surface) {
      const fm = parseFrontmatterFolded(readFileSync(join(repoRoot, rel), 'utf8'));
      expect(fm.name, rel).toBe(name);
      expect(fm.description, rel).toBeTruthy();
      expect(fm.description, `${rel}: folded scalar left unread`).not.toBe('>');
      expect(fm.description.length, rel).toBeGreaterThan(40);
    }
  });

  it('the folded parser actually unfolds — a guard that reads ">" guards nothing', () => {
    const fixture = ['---', 'name: demo', 'description: >', '  first line', '  second line', '---', 'body'].join('\n');
    const fm = parseFrontmatterFolded(fixture);
    expect(fm.description).toBe('first line second line');
    // and the original helper is why this one exists
    expect(parseFrontmatter(fixture).description).toBe('>');
  });

  // ── Audit 3, 2026-09-03. marketplace.json is how every install resolves this plugin, and
  // nothing parsed it: invalid JSON or a renamed entry would ship green.
  it('marketplace.json is valid and agrees with plugin.json', () => {
    const raw = readFileSync(join(repoRoot, '.claude-plugin/marketplace.json'), 'utf8');
    const mk = JSON.parse(raw) as {
      name: string;
      plugins: { name: string; source: string; description?: string }[];
    };
    const plugin = JSON.parse(readFileSync(join(repoRoot, '.claude-plugin/plugin.json'), 'utf8')) as {
      name: string;
    };
    expect(mk.name).toBe('grok-marketplace');
    expect(Array.isArray(mk.plugins)).toBe(true);
    expect(mk.plugins).toHaveLength(1);
    expect(mk.plugins[0].name, 'marketplace entry must match plugin.json name').toBe(plugin.name);
    expect(mk.plugins[0].name).toBe('grok');
    // source './' means the marketplace serves this repo itself — the version-keyed cache
    // rule in CLAUDE.md depends on it, so pin it.
    expect(mk.plugins[0].source).toBe('./');
    expect(mk.plugins[0].description ?? '').not.toBe('');
  });
});
