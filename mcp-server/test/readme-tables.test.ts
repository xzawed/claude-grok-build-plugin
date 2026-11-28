/**
 * MCP 2.0 plan, Task 3.1: the README tables state facts the code owns, so each one is read back from its source
 * (global rule §5 — a fact a machine can check is checked in CI). Both READMEs, the same way. Each check reads only
 * its own table, found by its header row — a troubleshooting row that starts with a command must not stand in for a
 * missing command row (review of PR #233):
 * - the command tables name every command in `commands/*.md` exactly once, and nothing else;
 * - the tool table names every tool `src/server.ts` registers exactly once, and nothing else;
 * - the requirements table states the Node.js floor of `mcp-server/package.json` `engines`, and so does every other
 *   "Node.js <n>" on the page and in the banner;
 * - the protocol table lists exactly the 2025 revisions the SDK exports, and the 2026 revision rpc-era.mjs speaks;
 * - every local file the page links or shows (markdown links and images, `href`, `src`, `srcset`) exists.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/server';
import { MODERN_VERSION } from '../../.claude/tools/rpc-era.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8').replaceAll('\r\n', '\n');
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : Number(a > b));
const sorted = (xs: string[]) => [...xs].sort(byCodeUnit);

const commands = sorted(readdirSync(join(root, 'commands')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)));
const tools = sorted([...read('mcp-server/src/server.ts').matchAll(/registerTool\(\s*'([a-z_]+)'/g)].map((m) => m[1]));
const engines = (JSON.parse(read('mcp-server/package.json')) as { engines: { node: string } }).engines.node;
const nodeFloor = /^>=\s*(\d+)/.exec(engines)?.[1];

interface Table { head: string[]; rows: string[][] }
/** A row's cells: the line without its outer pipes, split on every pipe that is not escaped. */
const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
/** The tables in reading order, outside fenced code: each one's header cells and body rows. */
function tables(md: string): Table[] {
  const out: Table[] = [];
  let current: Table | undefined;
  let fenced = false;
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; current = undefined; continue; }
    if (fenced || !line.startsWith('|')) { current = undefined; continue; }
    const row = cells(line);
    if (!current) { current = { head: row, rows: [] }; out.push(current); continue; }
    if (current.rows.length === 0 && row.every((c) => /^:?-{3,}:?$/.test(c))) continue;
    current.rows.push(row);
  }
  return out;
}
/** The tables whose first header cell is one of `heads` (bold markers ignored). */
const headed = (ts: Table[], heads: string[]) => ts.filter((t) => heads.includes(t.head[0].replaceAll('*', '')));
const codeSpans = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

/** Local targets the page links or shows. */
function localTargets(md: string): string[] {
  const out: string[] = [];
  const add = (t: string) => {
    const path = t.trim().split(/\s+/)[0].split('#')[0];
    if (path && !/^[a-z][a-z0-9+.-]*:/i.test(path)) out.push(decodeURI(path));
  };
  for (const m of md.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) add(m[1]);
  for (const m of md.matchAll(/\b(?:href|src)="([^"]+)"/g)) add(m[1]);
  for (const m of md.matchAll(/\bsrcset="([^"]+)"/g)) for (const part of m[1].split(',')) add(part);
  return out;
}

describe('the sources the README tables are read against', () => {
  it('are found where this test looks', () => {
    expect(commands.length).toBeGreaterThan(0);
    expect(tools.length).toBeGreaterThan(0);
    expect(nodeFloor).toMatch(/^\d+$/);
    expect(SUPPORTED_PROTOCOL_VERSIONS.length).toBeGreaterThan(0);
  });
});

describe.each([
  { file: 'README.md', command: 'Command', tool: 'Tool', requirement: 'Requirement', protocol: 'Protocol era', floor: (n: string) => `**${n} or newer**` },
  { file: 'README.ko.md', command: '커맨드', tool: '도구', requirement: '요구 사항', protocol: '프로토콜 계열', floor: (n: string) => `**${n} 이상**` },
])('$file', ({ file, command, tool, requirement, protocol, floor }) => {
  const md = read(file);
  const ts = tables(md);

  it('its command tables name every command in commands/*.md exactly once, and nothing else', () => {
    const rows = headed(ts, [command]).flatMap((t) => t.rows);
    const named = rows.map((r) => /^`\/grok:([a-z-]+)/.exec(r[0])?.[1] ?? `(not a command: ${r[0]})`);
    expect(sorted(named)).toEqual(commands);
  });

  it('its tool table names every tool src/server.ts registers exactly once, and nothing else', () => {
    const table = headed(ts, [tool]);
    expect(table).toHaveLength(1);
    const named = table[0].rows.map((r) => /^`(grok_[a-z_]+)`$/.exec(r[0])?.[1] ?? `(not a tool: ${r[0]})`);
    expect(sorted(named)).toEqual(tools);
  });

  it('its requirements table states the Node.js floor that engines declares', () => {
    const table = headed(ts, [requirement]);
    expect(table).toHaveLength(1);
    const node = table[0].rows.filter((r) => r[0] === 'Node.js');
    expect(node).toHaveLength(1);
    expect(node[0][1]).toContain(floor(nodeFloor!));
  });

  it('every "Node.js <n>" on the page and in the banner is the floor', () => {
    const named = [md, read('docs/images/hero-light.svg'), read('docs/images/hero-dark.svg')]
      .flatMap((text) => [...text.matchAll(/Node\.js[ -](\d+)/g)].map((m) => m[1]));
    expect(named.length).toBeGreaterThan(0);
    expect([...new Set(named)]).toEqual([nodeFloor]);
  });

  it('its protocol table lists exactly the 2025 revisions the SDK serves and the 2026 revision', () => {
    const table = headed(ts, [protocol]);
    expect(table).toHaveLength(1);
    const revisions = (era: string) => codeSpans(table[0].rows.find((r) => r[0] === era)?.[2] ?? '');
    expect(sorted(revisions('2025'))).toEqual(sorted([...SUPPORTED_PROTOCOL_VERSIONS]));
    expect(revisions(MODERN_VERSION)).toEqual([MODERN_VERSION]);
  });

  it('every local file it links or shows exists', () => {
    const missing = localTargets(md).filter((t) => !existsSync(join(root, t)));
    expect(missing).toEqual([]);
  });
});
