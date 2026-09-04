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
