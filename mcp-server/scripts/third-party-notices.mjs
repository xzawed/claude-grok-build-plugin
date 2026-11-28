// Writes dist/THIRD_PARTY_NOTICES.md from esbuild's metafile (MCP 2.0 plan, Task 2.6). The committed bundles inline
// third-party code, and the licenses of that code (MIT, BSD-3-Clause, Apache-2.0) ask for its notice to travel with the
// copy; end users receive dist/ and never run npm, so the notice lives beside the bundles.
//
// Two kinds of package reach a bundle. A node_modules package names itself in the metafile — by its innermost
// `node_modules/<pkg>`, so a package npm nests under another one is its own; its package.json gives the version and
// SPDX id, and its LICENSE file the text. The MCP SDK packages also carry third-party code INSIDE their own dist files
// (`//#region .../node_modules/.pnpm/<pkg>@<ver>/...` markers) with no node_modules folder of its own, and the SDK's
// LICENSE does not carry those packages' notices — measured 2026-11-28 on @modelcontextprotocol/server and core 2.4.0,
// whose one LICENSE is the project's MIT-to-Apache-2.0 transition note, the Apache-2.0 and MIT texts and a CC-BY-4.0
// pointer. Those texts are kept in third-party/licenses (vendored.json says where each came from). The build stops on
// a vendored package the bundle reaches that is not kept, and on a region from node_modules in any other layout: an
// SDK update that vendors something new must bring its notice with it.
//
// The output depends on nothing but its inputs: packages sorted by name, LF line endings, no dates.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const lf = (s) => s.replaceAll('\r\n', '\n');
/** Code-unit order — what `sort()` does with no comparator — so the file is the same on every machine (`localeCompare` is not). */
function byCodeUnit(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
const byName = (a, b) => byCodeUnit(a.name, b.name) || byCodeUnit(a.version, b.version);
/**
 * A metafile input (`/`-separated) → the folder of its innermost package, that package's name and the file inside it;
 * undefined for an input that is no package's file. The innermost `node_modules/` is the one npm nested it under.
 */
function packageOf(input) {
  const marker = 'node_modules/';
  const at = input.lastIndexOf(marker);
  if (at === -1) return undefined;
  const parts = input.slice(at + marker.length).split('/');
  const nameParts = parts[0].startsWith('@') ? 2 : 1;
  if (parts.length <= nameParts || parts.slice(0, nameParts + 1).includes('')) return undefined;
  const name = parts.slice(0, nameParts).join('/');
  return { rel: input.slice(0, at) + marker + name, name, file: parts.slice(nameParts).join('/') };
}
/** Every region a bundled file marks as code from node_modules … */
const REGION = /\/\/#region [^\n]*node_modules\/[^\n]*/g;
/** … and the one layout whose package and version this script can read from it. */
const VENDORED = /node_modules\/\.pnpm\/((?:@[^+/]+\+)?[^@/]+)@([^_/]+)/;

function licenseText(dir) {
  for (const f of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license']) {
    if (existsSync(join(dir, f))) return lf(readFileSync(join(dir, f), 'utf8')).trim();
  }
  throw new Error(`third-party notices: no license file in ${dir}`);
}

function fenced(text) {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}`;
}

/** @param {import('esbuild').Metafile} metafile @param {string} root the mcp-server folder */
export function thirdPartyNotices(metafile, root) {
  const kept = JSON.parse(readFileSync(join(root, 'third-party', 'vendored.json'), 'utf8')).packages;
  const top = new Map();
  const vendored = new Map();
  const outputs = Object.keys(metafile.outputs).sort(byCodeUnit);
  for (const out of outputs) {
    const bundle = out.replaceAll('\\', '/').split('/').pop();
    for (const [input, { bytesInOutput }] of Object.entries(metafile.outputs[out].inputs)) {
      const found = packageOf(input.replaceAll('\\', '/'));
      if (!found || bytesInOutput === 0) continue;
      const { rel, name, file } = found;
      const dir = join(root, rel);
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      const id = `${name}@${pkg.version}`;
      if (!top.has(id)) {
        top.set(id, { name, version: pkg.version, license: pkg.license, rel, text: licenseText(dir), bundles: new Set() });
      }
      top.get(id).bundles.add(bundle);
      for (const [region] of readFileSync(join(dir, file), 'utf8').matchAll(REGION)) {
        const v = VENDORED.exec(region);
        if (!v) {
          throw new Error(`third-party notices: ${name} (${file}) carries code from node_modules in a layout this script `
            + `cannot read (${region.trim()}) — find its package, keep its license in third-party/, and teach `
            + 'scripts/third-party-notices.mjs that layout.');
        }
        const vname = v[1].replace('+', '/');
        const key = `${vname}@${v[2]}`;
        const k = kept.find((p) => p.name === vname && p.version === v[2]);
        if (!k) {
          throw new Error(`third-party notices: ${name} (${file}) vendors ${key}, which mcp-server/third-party/vendored.json `
            + 'does not keep — copy package/LICENSE from its npm tarball into third-party/licenses and list it there.');
        }
        if (!vendored.has(key)) {
          vendored.set(key, { name: vname, version: v[2], license: k.license, integrity: k.integrity, inside: new Set(), bundles: new Set(),
            text: lf(readFileSync(join(root, 'third-party', 'licenses', k.file), 'utf8')).trim() });
        }
        vendored.get(key).inside.add(`${name} ${pkg.version}`);
        vendored.get(key).bundles.add(bundle);
      }
    }
  }
  const list = (set) => [...set].sort(byCodeUnit).map((b) => `\`${b}\``).join(', ');
  const parts = [
    '# Third-party notices',
    '',
    'The bundles in this folder inline the third-party code below at build time, so its license notices travel with',
    'them here. Generated by `mcp-server/build.mjs` (`scripts/third-party-notices.mjs`) from esbuild\'s metafile — do',
    'not edit by hand.',
  ];
  for (const e of [...top.values()].sort(byName)) {
    parts.push('', `## ${e.name} ${e.version} — ${e.license}`, '', `In ${list(e.bundles)}, from \`${e.rel}\`.`, '', fenced(e.text));
  }
  for (const e of [...vendored.values()].sort(byName)) {
    parts.push('', `## ${e.name} ${e.version} — ${e.license}`, '',
      `In ${list(e.bundles)}, vendored inside ${[...e.inside].sort(byCodeUnit).join(', ')} (no node_modules folder of its own). The text`,
      `is package/LICENSE from the npm tarball \`${e.integrity}\`.`, '', fenced(e.text));
  }
  return parts.join('\n') + '\n';
}

export function writeThirdPartyNotices(metafile, root, outFile) {
  writeFileSync(outFile, thirdPartyNotices(metafile, root), 'utf8');
}
