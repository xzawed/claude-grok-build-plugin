/**
 * Repo-root plugin packaging surface (commands/skills/agents) — keeps first-mile
 * assets discoverable and frontmatter valid.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

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
});
