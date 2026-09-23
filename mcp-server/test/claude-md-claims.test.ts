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
    // Lowered 50 -> 30 on 2026-09-23, the SECOND floor moved in one day (the identifier floor
    // above was the first), because CLAUDE.md is being deliberately cut toward its 200-line budget
    // and legitimately names fewer paths. Both floors guard THE EXTRACTOR — that a rewrite cannot
    // make `missing` vacuously empty — not the document's length.
    //
    // ⚠️ IF YOU ARE LOWERING ONE OF THESE AGAIN, STOP AND ASK A DIFFERENT QUESTION. Twice is a
    // shrinking document; a third time is a guard being sanded down to fit whatever the file
    // happens to be. The question then is whether CLAUDE.md still names the things a session must
    // not get wrong — which no floor can answer, and a person has to.
    expect(pathish.length, 'sanity: the extractor must still find paths to check').toBeGreaterThan(30);

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
    // The floor guards THIS TEST, not the document: if a rewrite ever stops the extractor finding
    // anything, `missing` would be trivially empty and the check would pass while proving nothing.
    //
    // Lowered from 20 on 2026-09-23, deliberately, when CLAUDE.md was cut from 504 lines toward its
    // own 200-line budget. That cut dropped ~63 quoted names — per-file descriptions the source
    // already owns — and kept 15, which are the ones carrying a trap: NON_HEADLESS, planWroteFiles,
    // AUTH_ERROR_SIGNALS, bestOfN, isError, killTree, parsePorcelain and the rest. So the file
    // names fewer identifiers ON PURPOSE, and a floor calibrated to the bloated version would have
    // forced padding the doc to satisfy a test — backwards. Ten still proves the extractor works.
    expect(identifiers.length, 'sanity: the extractor must still find identifiers').toBeGreaterThan(10);

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

  // MEASURED 2026-09-22 during a hidden-code / orphan-doc audit: four LIVE docs assert a tool
  // COUNT in prose — CLAUDE.md twice, docs/03-plugin-spec.md, docs/04-mcp-server-spec.md — and
  // nothing compared any of them to the server. The count itself is pinned on the code side
  // (tool-surface.test.ts asserts EXPECTED_MCP_TOOLS.length), so a tenth tool would update that
  // test and leave all four sentences quietly false.
  //
  // The global rule this serves: an extractable fact may live in prose only in a machine-checkable
  // form. This is that form. It is NOT a reason to start sprinkling counts into docs — the same
  // rule prefers no number at all.
  //
  // Dated narrative is deliberately out of scope: CHANGELOG.md and docs/releases/ record what was
  // true at a release and must not be rewritten when the count moves.
  it('every live doc that states a tool count states the real one', () => {
    const server = readFileSync(join(repoRoot, 'mcp-server/src/server.ts'), 'utf8');
    const registered = (server.match(/server\.registerTool\(/g) ?? []).length;
    expect(registered).toBeGreaterThan(0);

    const LIVE = ['CLAUDE.md', 'docs/03-plugin-spec.md', 'docs/04-mcp-server-spec.md'];
    const wrong: string[] = [];
    for (const rel of LIVE) {
      const text = readFileSync(join(repoRoot, rel), 'utf8');
      text.split('\n').forEach((line, i) => {
        // "9 tools", "9개 tool", "**9 tools**" — the shapes these four sentences actually use.
        for (const m of line.matchAll(/(\d+)\s*(?:개\s*)?tools?\b/gi)) {
          const claimed = Number(m[1]);
          if (claimed !== registered) wrong.push(`${rel}:${i + 1} says ${claimed}, server registers ${registered}`);
        }
      });
    }
    expect(wrong, 'a live doc states a tool count the server does not match').toEqual([]);
  });
});
