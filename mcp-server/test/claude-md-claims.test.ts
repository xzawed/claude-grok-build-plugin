/**
 * CLAUDE.md is read at the start of every session in this repo, so a false claim in it
 * misleads every future agent before a single line of code is opened. These checks pin the
 * part of that file a machine can settle.
 *
 * Why it exists: on 2026-09-11 PR #104 raised the vitest floor to ^4.1.11 while the copy
 * inside CLAUDE.md went on saying ^4.1.0. Nothing caught it — the file is documentation, and
 * no test read it. It took a human-directed review a day later to notice. The fix removed the
 * copies rather than refreshing them, and the first test below keeps them from coming back.
 *
 * What these checks CANNOT do: they prove a named thing EXISTS, never that the prose around
 * it is right. A sentence naming a real function and describing the wrong behaviour passes
 * every assertion here. That gap was covered once by hand — 25 prose contracts spot-checked
 * against source on 2026-09-12, all holding — and that pass is not automated. Do not read a
 * green run here as "the handoff file is true"; read it as "nothing it names has vanished".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const claudeMd = readFileSync(join(repoRoot, 'CLAUDE.md'), 'utf8');

/** Every backtick-quoted token in the file. CRLF-safe: the class excludes both line endings. */
const quoted = [...new Set([...claudeMd.matchAll(/`([^`\r\n]+)`/g)].map((m) => m[1]))];

/**
 * Names that are real but belong to someone else's surface, so they are not expected to
 * appear in our source: Claude Code's own error strings and env vars, grok CLI vocabulary,
 * and `execSync`, which CLAUDE.md names precisely to forbid it.
 */
const FOREIGN_NAMES = new Set([
  'execSync',
  'CONNECTION_CLOSED',
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_PLUGIN_ROOT',
  'SessionToken',
  'EndTurn',
  'PreToolUse',
  'autoUpdate',
  'GROK_BUILD_AUTH_MODE',
  'GROK_HOME',
  'GROK_BIN_DIR',
  'XAI_API_KEY',
  'GROK_CODE_XAI_API_KEY',
]);

/**
 * Tokens shaped like a repo path that deliberately are not one: a user's home file, the
 * scratch file the Grok review recipe tells you to create, and the marketplace `source`
 * value, which is the literal string "./".
 */
const NOT_REPO_FILES = new Set(['auth.json', 'verdict.md', 'docs/...', './']);

/** Prefixes CLAUDE.md writes paths relative to, in the order the prose implies. */
const PATH_ROOTS = [
  '',
  'mcp-server/',
  'mcp-server/src/',
  'mcp-server/test/',
  'mcp-server/scripts/',
  '.claude/tools/',
  '.claude/skills/',
];

describe('CLAUDE.md machine-checkable claims', () => {
  it('declares no dependency version floor — package.json is the only source', () => {
    // A caret range is the shape of a floor declaration. Bare versions stay allowed: the
    // `--no-save` and grok-CLI gotchas quote measured numbers as history (1.29.0 -> 1.30.0,
    // 1.0.5 -> 1.0.13), and history does not go stale the way a current-state claim does.
    const floors = quoted.filter((t) => /^\^\d+\.\d+\.\d+$/.test(t));
    expect(
      floors,
      'CLAUDE.md must not restate dependency floors — they drift silently (measured 2026-09-11, vitest ^4.1.0 vs ^4.1.11). Point at mcp-server/package.json instead.',
    ).toEqual([]);
  });

  it('names no file that has been moved or deleted', () => {
    const pathish = quoted.filter(
      (t) =>
        !NOT_REPO_FILES.has(t) &&
        // `docs/09` and friends are the abbreviation this repo uses for docs/09-*.md.
        !/^docs\/\d\d$/.test(t) &&
        (/^[./A-Za-z0-9_-]+\.(ts|js|mjs|json|md|yml)$/.test(t) ||
          /^[A-Za-z0-9._/-]+\/$/.test(t) ||
          /^(docs|mcp-server|commands|skills|agents|hooks|examples|scripts|test|src|\.claude|\.github)[A-Za-z0-9._/-]*$/.test(
            t,
          )),
    );
    expect(pathish.length, 'sanity: the extractor must still find paths to check').toBeGreaterThan(50);

    const missing = pathish.filter(
      (t) => !PATH_ROOTS.some((root) => existsSync(join(repoRoot, root, t.replace(/^\.\//, '')))),
    );
    expect(missing, 'CLAUDE.md points at files that no longer exist').toEqual([]);
  });

  it('names no npm script that has been renamed', () => {
    const scripts = new Set(
      Object.keys(JSON.parse(readFileSync(join(repoRoot, 'mcp-server/package.json'), 'utf8')).scripts),
    );
    const referenced = [...new Set([...claudeMd.matchAll(/npm run ([a-z:]+)/g)].map((m) => m[1]))];
    expect(referenced.length).toBeGreaterThan(0);
    expect(referenced.filter((s) => !scripts.has(s))).toEqual([]);
  });

  it('names no source identifier that has been renamed away', () => {
    const srcDir = join(repoRoot, 'mcp-server/src');
    const source = readdirSync(srcDir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => readFileSync(join(srcDir, f), 'utf8'))
      .join('\n');

    // camelCase or SCREAMING_CASE tokens — the shape CLAUDE.md uses for functions, consts
    // and types. Single lowercase words are excluded: too many are prose, not identifiers.
    const identifiers = quoted.filter(
      (t) =>
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(t) &&
        /[a-z][A-Z]|^[A-Z_]{4,}$/.test(t) &&
        !FOREIGN_NAMES.has(t),
    );
    expect(identifiers.length, 'sanity: the extractor must still find identifiers').toBeGreaterThan(20);

    const missing = identifiers.filter((id) => !source.includes(id));
    expect(missing, 'CLAUDE.md names identifiers that are gone from mcp-server/src').toEqual([]);
  });

  it('names no MCP tool that is not registered', () => {
    const server = readFileSync(join(repoRoot, 'mcp-server/src/server.ts'), 'utf8');
    const tools = [...new Set([...claudeMd.matchAll(/\b(grok_[a-z_]+)\b/g)].map((m) => m[1]))];
    // Not every grok_* token is a tool — auth.ts status values share the prefix. Check the
    // ones the server is supposed to register, which is what a reader would go looking for.
    const toolNames = tools.filter((t) => t.startsWith('grok_build_') || t === 'grok_cli' || t === 'grok_auth_check');
    expect(toolNames.length).toBeGreaterThan(5);
    expect(toolNames.filter((t) => !server.includes(t))).toEqual([]);
  });
});
