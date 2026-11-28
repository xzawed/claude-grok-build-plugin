// Draws docs/images/status-dashboard.svg — the README's "What a fresh install shows" — from what the built bundle's
// grok_build_status answers on a fresh install, and reads the figure back for test/readme-status-figure.test.ts, so the
// figure is the tool's real output and stays so (MCP 2.0 plan, Task 3.2; review of PR #233).
//
// "A fresh install": a throwaway home whose session file is an empty placeholder (`{}`) and that has no delegation
// history, with an empty file named `grok` as the installed CLI (the acceptance grader's placeholder) and PATH cut down
// to Node's own folder. The result is then the same on every machine and holds nothing about the one it ran on. The
// tool checks only that the session file exists, never its contents (docs/10 A56), so a real `grok login` answers the
// same. Nothing here starts grok or spends quota.
//
// usage (from mcp-server/, after `npm run build`): node scripts/status-figure.mjs  → rewrites docs/images/status-dashboard.svg
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openSession } from '../../.claude/tools/rpc-era.mjs';

/** The text grok_build_status answers in a fresh install, from the bundle at `bundle`. */
export async function freshInstallStatus(bundle) {
  const base = mkdtempSync(join(tmpdir(), 'status-figure-'));
  const home = join(base, 'home');
  const bin = join(base, 'bin');
  mkdirSync(join(home, '.grok'), { recursive: true });
  mkdirSync(bin);
  writeFileSync(join(home, '.grok', 'auth.json'), '{}');
  writeFileSync(join(bin, 'grok'), '');
  const env = {
    HOME: home, USERPROFILE: home, GROK_HOME: join(home, '.grok'), CLAUDE_CONFIG_DIR: join(home, '.claude'),
    GROK_BIN_DIR: bin, PATH: dirname(process.execPath),
  };
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    env.SystemRoot = systemRoot;
    env.PATH = [dirname(process.execPath), join(systemRoot, 'System32'), systemRoot].join(';');
    env.PATHEXT = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD';
  }
  const child = spawn(process.execPath, [bundle], { env, cwd: base, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const gone = new Promise((resolve) => { child.once('exit', resolve); child.once('error', resolve); });
  try {
    const session = await openSession(child, 'legacy', { timeoutFor: () => 15_000 });
    const reply = await session.request('tools/call', { name: 'grok_build_status', arguments: {} });
    const text = reply.result?.content?.[0]?.text;
    if (typeof text !== 'string') throw new Error(`grok_build_status gave no text: ${JSON.stringify(reply).slice(0, 300)}`);
    return text.replaceAll('\r\n', '\n');
  } finally {
    child.kill();
    await gone;
    // Windows can refuse a folder for a moment after its process exits (EBUSY): retry, and never let the cleanup hide
    // the error the run itself threw.
    try { rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* left in the temp folder */ }
  }
}

const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const unesc = (s) => s.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
const COLORS = { key: '#79c0ff', str: '#a5d6ff', lit: '#ff7b72', num: '#d2a8ff', punct: '#8b949e' };

/** One line of the tool's JSON → [kind, text] runs; strings keep their escapes as printed. */
function runs(line) {
  const out = [];
  const push = (kind, s) => { if (s) out.push([kind, s]); };
  const lead = /^\s*/.exec(line)[0];
  push('punct', lead);
  let i = lead.length;
  while (i < line.length) {
    const rest = line.slice(i);
    let m;
    if ((m = /^"(?:[^"\\]|\\.)*"/.exec(rest))) {
      push(/^\s*:/.test(rest.slice(m[0].length)) ? 'key' : 'str', m[0]);
      i += m[0].length;
    } else if ((m = /^(?:true|false|null)\b/.exec(rest))) {
      push('lit', m[0]);
      i += m[0].length;
    } else if ((m = /^-?\d+(?:\.\d+)?/.exec(rest))) {
      push('num', m[0]);
      i += m[0].length;
    } else {
      push('punct', rest[0]);
      i += 1;
    }
  }
  return out;
}

/** The figure: `text` drawn line for line, unchanged — only colored. Static SVG, no script, no external font. */
export function statusFigureSvg(text, version) {
  const lines = text.split('\n');
  // The widest line measured 814 px in Chromium on Windows (Consolas, Malgun Gothic for Hangul); 920 leaves room for
  // wider fallback fonts elsewhere.
  const PAD = 28; const TOP = 64; const LH = 22; const W = 920;
  const H = TOP + (lines.length - 1) * LH + 30;
  const body = lines.map((line, n) => {
    const spans = runs(line).map(([kind, s]) => `<tspan fill="${COLORS[kind]}">${esc(s)}</tspan>`).join('');
    return `  <text x="${PAD}" y="${TOP + n * LH}" xml:space="preserve">${spans}</text>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
  <title id="t">grok_build_status on a fresh install</title>
  <desc id="d">The unchanged JSON result of the grok_build_status tool from the v${version} bundle, in a fresh home whose session file is an empty placeholder and that has no delegation history. The tool checks only that the session file exists, so ready true means the file is there, not that the session works. The server's messages are in Korean.</desc>
  <rect width="${W}" height="${H}" rx="12" fill="#0d1117"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="#30363d"/>
  <circle cx="24" cy="22" r="6" fill="#ff5f57"/><circle cx="44" cy="22" r="6" fill="#febc2e"/><circle cx="64" cy="22" r="6" fill="#28c840"/>
  <text x="${W / 2}" y="27" text-anchor="middle" fill="#8b949e" font-family="system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="13">grok_build_status — grok-build ${version}, a fresh install</text>
  <line x1="0" y1="40" x2="${W}" y2="40" stroke="#30363d"/>
  <g font-family="ui-monospace, SFMono-Regular, 'Cascadia Mono', Consolas, 'Liberation Mono', Menlo, monospace" font-size="14">
${body}
  </g>
</svg>
`;
}

/** The lines a figure draws, read back as text. */
export function drawnLines(svg) {
  return [...svg.matchAll(/<text x="28"[^>]*>(.*?)<\/text>/g)].map((m) => unesc(m[1].replace(/<[^>]+>/g, '')));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const here = dirname(fileURLToPath(import.meta.url));
  const version = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version;
  const text = await freshInstallStatus(join(here, '..', 'dist', 'index.js'));
  const out = join(here, '..', '..', 'docs', 'images', 'status-dashboard.svg');
  writeFileSync(out, statusFigureSvg(text, version), 'utf8');
  console.log(`${out}: ${text.split('\n').length} lines, grok-build ${version}`);
}
