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
