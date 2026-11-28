/**
 * The README's "What a fresh install shows" figure (docs/images/status-dashboard.svg) is the built bundle's real
 * grok_build_status answer on a fresh install, and stays so: when the server's messages or fields change, this fails
 * and `node scripts/status-figure.mjs` redraws it (review of PR #233). `serverVersion` is the one line allowed to
 * differ — a figure from an older release stays true about that release — and the version it shows must be the one
 * its title bar and both READMEs' captions name. Nothing here starts grok: the fresh install's `grok` is an empty
 * placeholder, and the tool only checks that it and the session file exist.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drawnLines, freshInstallStatus } from '../scripts/status-figure.mjs';
import { bundlePath } from './bundle-client.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8').replaceAll('\r\n', '\n');
const svg = read('docs/images/status-dashboard.svg');
const drawn = drawnLines(svg);
const figureVersion = /"serverVersion": "(\d+\.\d+\.\d+)"/.exec(drawn.join('\n'))?.[1];

/** The text of a README section, from its heading to the next heading of any level. */
function section(md: string, heading: string): string {
  const start = md.indexOf(`\n### ${heading}\n`);
  if (start === -1) return '';
  const next = md.slice(start + 1).search(/\n#{1,6} /);
  return next === -1 ? md.slice(start) : md.slice(start, start + 1 + next);
}

describe('the README status figure', () => {
  it('draws what the built bundle answers on a fresh install, line for line (serverVersion aside)', async () => {
    const now = (await freshInstallStatus(bundlePath)).split('\n');
    const others = (lines: string[]) => lines.filter((l) => !/^\s*"serverVersion": /.test(l));
    expect(drawn.length).toBeGreaterThan(0);
    expect(others(drawn)).toEqual(others(now));
  }, 60_000);

  it.each([
    ['README.md', 'What a fresh install shows'],
    ['README.ko.md', '새로 설치하면 보이는 것'],
  ])('shows the version its title bar and the %s caption name', (file, heading) => {
    expect(figureVersion).toBeDefined();
    expect(svg).toContain(`grok-build ${figureVersion}, a fresh install`);
    const caption = section(read(file), heading);
    expect([...caption.matchAll(/\bv(\d+\.\d+\.\d+)\b/g)].map((m) => m[1])).toEqual([figureVersion]);
  });
});
