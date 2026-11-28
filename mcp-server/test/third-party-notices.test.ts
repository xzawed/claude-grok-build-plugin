/**
 * MCP 2.0 plan, Task 2.6: the committed bundles inline third-party code, and every license that code carries (MIT,
 * BSD-3-Clause, Apache-2.0) asks for its notice to travel with the copy. End users receive dist/ and never run npm, so
 * the notices live beside the bundles in dist/THIRD_PARTY_NOTICES.md, which build.mjs writes from esbuild's metafile.
 *
 * This test derives the expected list a SECOND way: from the module path comments esbuild leaves in the committed
 * bundles (the innermost `node_modules/<pkg>` of each, so a package npm nests under another is its own), plus the code
 * the MCP SDK vendors inside its own dist files (`//#region .../node_modules/.pnpm/<pkg>@<ver>` markers). That vendored
 * code has no node_modules folder, and the SDK's own LICENSE does not carry its notices (measured 2026-11-28:
 * @modelcontextprotocol/server and core 2.4.0 ship one LICENSE — the project's MIT-to-Apache-2.0 transition note, the
 * Apache-2.0 and MIT texts and a CC-BY-4.0 pointer), so its license texts are kept in third-party/licenses, copied
 * from the npm tarballs whose integrity third-party/vendored.json records.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { thirdPartyNotices } from '../scripts/third-party-notices.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lf = (s: string) => s.replace(/\r\n/g, '\n');
const read = (...p: string[]) => lf(readFileSync(join(root, ...p), 'utf8'));

interface Entry { name: string; version: string; license: string; text: string }

function licenseText(dir: string): string {
  for (const f of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license']) {
    if (existsSync(join(dir, f))) return lf(readFileSync(join(dir, f), 'utf8'));
  }
  throw new Error(`no license file in ${dir}`);
}

function expected(): { top: Entry[]; vendored: Entry[]; unreadRegions: string[] } {
  // package folder (relative to mcp-server/, the innermost node_modules/<pkg>) -> its files that reach a bundle
  const files = new Map<string, { name: string; inside: Set<string> }>();
  for (const bundle of ['dist/index.js', 'dist/hook.js']) {
    for (const m of read(bundle).matchAll(/^\/\/ (.*node_modules\/((?:@[^/]+\/)?[^/]+))\/(\S+)$/gm)) {
      if (!files.has(m[1])) files.set(m[1], { name: m[2], inside: new Set() });
      files.get(m[1])!.inside.add(m[3]);
    }
  }
  const kept = JSON.parse(read('third-party', 'vendored.json')) as { packages: Array<{ name: string; version: string; license: string; file: string }> };
  const top = new Map<string, Entry>();
  const vendored = new Map<string, Entry>();
  const unreadRegions: string[] = [];
  for (const [rel, { name, inside }] of files) {
    const dir = join(root, rel);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string; license: string };
    top.set(`${name}@${pkg.version}`, { name, version: pkg.version, license: pkg.license, text: licenseText(dir) });
    for (const f of inside) {
      for (const region of lf(readFileSync(join(dir, f), 'utf8')).matchAll(/\/\/#region [^\n]*node_modules\/[^\n]*/g)) {
        const m = /node_modules\/\.pnpm\/((?:@[^+/]+\+)?[^@/]+)@([^_/]+)/.exec(region[0]);
        if (!m) { unreadRegions.push(`${rel}/${f}: ${region[0]}`); continue; }
        const vname = m[1].replace('+', '/');
        const key = `${vname}@${m[2]}`;
        if (vendored.has(key)) continue;
        const k = kept.packages.find((p) => p.name === vname && p.version === m[2]);
        vendored.set(key, { name: vname, version: m[2], license: k?.license ?? '(not kept)', text: k ? read('third-party', 'licenses', k.file) : '' });
      }
    }
  }
  return { top: [...top.values()], vendored: [...vendored.values()], unreadRegions };
}

describe('dist/THIRD_PARTY_NOTICES.md (MCP 2.0 plan, Task 2.6)', () => {
  const notices = existsSync(join(root, 'dist', 'THIRD_PARTY_NOTICES.md')) ? read('dist', 'THIRD_PARTY_NOTICES.md') : '';
  const { top, vendored, unreadRegions } = expected();
  const sections = new Map(
    notices.split(/^(?=## )/m).filter((s) => s.startsWith('## ')).map((s) => [s.slice(3, s.indexOf('\n')), s]),
  );
  const heading = (e: Entry) => `${e.name} ${e.version} — ${e.license}`;

  it('exists beside the bundles', () => {
    expect(notices).not.toBe('');
  });

  it('names exactly the packages the bundles carry, node_modules and vendored alike', () => {
    expect([...sections.keys()].sort()).toEqual([...top, ...vendored].map(heading).sort());
  });

  it('keeps every vendored package that the bundles reach, and no other', () => {
    const kept = JSON.parse(read('third-party', 'vendored.json')) as { packages: Array<{ name: string; version: string }> };
    expect(kept.packages.map((p) => `${p.name}@${p.version}`).sort()).toEqual(vendored.map((e) => `${e.name}@${e.version}`).sort());
  });

  it('carries each license text in full', () => {
    for (const e of [...top, ...vendored]) {
      expect(e.text.trim(), heading(e)).not.toBe('');
      expect(sections.get(heading(e)) ?? '', heading(e)).toContain(e.text.trim());
    }
  });

  // A notice that is generated but not shipped, or shipped stale, fails users the same way.
  it('is committed beside the bundles and checked fresh by CI like them', () => {
    const repo = join(root, '..');
    const ignored = spawnSync('git', ['check-ignore', '-q', 'mcp-server/dist/THIRD_PARTY_NOTICES.md'], { cwd: repo });
    expect(ignored.status, 'git check-ignore: 0 = ignored, 1 = not ignored').toBe(1);
    const ci = lf(readFileSync(join(repo, '.github', 'workflows', 'ci.yml'), 'utf8'));
    const check = ci.split('\n').find((l) => l.includes('git diff --exit-code -- dist/'));
    expect(check).toContain('dist/THIRD_PARTY_NOTICES.md');
  });

  // The second derivation reads only the layout the manifest knows; code from node_modules in any other layout would
  // escape both it and the generator, so its absence is asserted, not assumed (review of PR #231).
  it('finds every node_modules region the bundled files carry in the layout the manifest reads', () => {
    expect(unreadRegions).toEqual([]);
  });
});

// The generator on layouts the committed bundles do not have today (review of PR #231): a package npm nests under
// another one — server and client pin core exactly, so bumping one of them nests a second core — and a vendored
// region outside the pnpm layout. Synthetic metafiles over a throwaway root; nothing here reads the real tree.
describe('scripts/third-party-notices.mjs on layouts the bundles may reach', () => {
  const put = (base: string, rel: string, text: string) => {
    mkdirSync(dirname(join(base, rel)), { recursive: true });
    writeFileSync(join(base, rel), text);
  };
  const pkg = (base: string, rel: string, name: string, version: string, license: string, body = '') => {
    put(base, `${rel}/package.json`, JSON.stringify({ name, version, license }));
    put(base, `${rel}/LICENSE`, `${name} license text`);
    put(base, `${rel}/index.js`, body);
  };
  const meta = (...inputs: string[]) => ({
    outputs: { 'dist/index.js': { inputs: Object.fromEntries(inputs.map((i) => [i, { bytesInOutput: 10 }])) } },
  });
  let base = '';
  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'tpn-layouts-'));
    put(base, 'third-party/vendored.json', JSON.stringify({ packages: [] }));
    pkg(base, 'node_modules/outer', 'outer', '1.0.0', 'MIT');
    pkg(base, 'node_modules/outer/node_modules/@scope/inner', '@scope/inner', '2.0.0', 'ISC');
    pkg(base, 'node_modules/flat', 'flat', '3.0.0', 'MIT', '//#region ../../node_modules/vend/dist/x.js\nvar x = 1;\n//#endregion\n');
    pkg(base, 'node_modules/pnpm', 'pnpm', '4.0.0', 'MIT', '//#region ../../node_modules/.pnpm/vend@5.0.0/node_modules/vend/x.js\nvar x = 1;\n//#endregion\n');
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it('gives a package nested under another one a notice of its own', () => {
    const out = thirdPartyNotices(meta('node_modules/outer/index.js', 'node_modules/outer/node_modules/@scope/inner/index.js'), base);
    expect(out).toContain('## outer 1.0.0 — MIT');
    expect(out).toContain('## @scope/inner 2.0.0 — ISC');
    expect(out).toContain('@scope/inner license text');
    expect(out).toContain('from `node_modules/outer/node_modules/@scope/inner`');
  });

  it('stops on a vendored region outside the pnpm layout, naming it', () => {
    expect(() => thirdPartyNotices(meta('node_modules/flat/index.js'), base)).toThrow(/node_modules\/vend\/dist\/x\.js/);
  });

  it('stops on a pnpm-layout vendored package the manifest does not keep (as before)', () => {
    expect(() => thirdPartyNotices(meta('node_modules/pnpm/index.js'), base)).toThrow(/vendors vend@5\.0\.0/);
  });
});
