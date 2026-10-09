/**
 * CHANGELOG.md is an INDEX, not a diary (2026-10-09, owner request). It had grown to 3,099 lines / 326,575 bytes — one
 * release's review diary alone was 91,734 — and the file reader an agent uses returns at most 2,000 lines and about
 * 25,000 tokens per call, so no session could read it whole. Its 106 entries moved byte for byte to
 * docs/history/<work date>.md and the index kept their dates and titles. Design, the Grok rounds and the review that
 * shaped these checks: docs/specs/2026-10-09-changelog-index-design.md.
 *
 * What is asserted, exactly:
 *  - the whole file stays within one read (bytes and lines) and carries no BOM and no control or bidi characters;
 *  - the preamble — the rules and the redirect that pointers elsewhere ("CHANGELOG.md v0.2.35", "CHANGELOG 57", frozen
 *    release notes included) rely on — is pinned by hash, so it changes only on purpose;
 *  - between the preamble and the moved-titles index there are only `## YYYY-MM-DD` headings (real dates from
 *    2026-10-09 on, newest first), each with at least one `- ` bullet of at most MAX_ENTRY_CODE_POINTS (NFC; indented
 *    continuation lines count, a line break counts as one space); nothing in that span may open another Markdown block
 *    (heading, HTML, fence, quote, table, nested list, rule) — a line indented by one space, or `<!--`, would leave the
 *    bullet and could hide or fake the index on GitHub (review round 2, checked on GitHub's renderer);
 *  - the moved-titles index equals what docs/history/ derives to: per file, its date and file, then its `###` titles;
 *  - docs/history/ holds exactly the moved files (OS clutter aside), each pinned by hash.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const BOM = String.fromCharCode(0xfeff);
/** CRLF and a lone CR are both line breaks to a Markdown renderer; read them as such. */
const lf = (s: string) => s.replace(/\r\n?/g, '\n');
const readText = (path: string) => lf(readFileSync(path, 'utf8').replace(new RegExp(`^${BOM}`), ''));
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const changelogPath = join(repoRoot, 'CHANGELOG.md');
const changelog = readText(changelogPath);
const lines = changelog.split('\n');
if (lines[lines.length - 1] === '') lines.pop();
const historyDir = join(repoRoot, 'docs/history');

/** Separates new entries (above) from the titles of the moved ones (below). */
const MOVED_INDEX = '## 옮긴 항목 색인 — 2026-07-25 ~ 2026-10-09';
/** About two wrapped lines. Anything longer belongs in the source the bullet points at. */
const MAX_ENTRY_CODE_POINTS = 300;
/**
 * One read. The reader stops at 2,000 lines or about 25,000 tokens; this mostly-Korean text runs about 2 bytes per token
 * (measured 2026-10-09: a 113 KB variant read as 54,916 tokens), so 40,000 bytes keeps a margin.
 */
const MAX_LINES = 2000;
const MAX_BYTES = 40_000;
/** New entries start the day the old ones moved out. */
const FIRST_NEW_DATE = '2026-10-09';
const LAST_PLAUSIBLE_DATE = '2099-12-31';
/** sha256 of the preamble: the lines before the first `## `, LF, joined by '\n'. */
const PREAMBLE_SHA256 = 'ba72585fbbc365d55b6141c1c0129d81849bf83feb18b143b5fe3ddcdd79cf35';
/** Files an OS may drop into any folder; nothing else may appear in docs/history/. */
const OS_CLUTTER = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

/** sha256 of each moved file as of the move (LF). Text that moved verbatim does not change afterwards. */
const FROZEN: Record<string, string> = {
  '2026-10-09.md': 'b5f7a979e85b03f55b391fef51134a64a93c13c610f25ed8961afb84812d55aa',
  '2026-10-05.md': 'bf9686f75dcfc3be03ebf8754699044cf51adf9621f22ce4d20972de72e2c526',
  '2026-10-04.md': '14e7c55b4002a12b92800e28d681a2ccc8cb1491b6e3d12c8b73929395390b4b',
  '2026-09-30.md': 'dcd509cbefe86f8082fca50fe57d5b58d27fafb0514cb778d973f8ce40f2ae54',
  '2026-09-28.md': 'a511449855dda952c878896b614d54bc399c49d54fa38c8709275b0934cb27fb',
  '2026-09-25.md': '94180c4a1ed867c6dce990b7e6bc9db84373358602fa9cb9fd0108c354b41a47',
  '2026-09-24.md': 'f7efd2a2bb9b2bcdd6128d51f8c947c309db5dee0eb03766a4e57b1b50b0303f',
  '2026-09-23.md': '607f44bfc64ba3583cdd03bced4ac4b4e29bed6f5a9e96824e48b755c22a0f47',
  '2026-09-22.md': 'f3a8565e24b853f12f9e05ae3d841da21cbce223efaab77a8125baea223e0373',
  '2026-09-13.md': '6170779eb6fe6bc111754bc5f35f4d219a461d0bc294b2e64e6df779acd57a21',
  '2026-09-12.md': '58e8ef4577393bbf60e2f21b56d16da4d62914b78e4cf77797e3bb785be88a6a',
  '2026-09-06.md': '55402fbc9ae4d4e33dd6ab71044bd66d8eb6e872b4832e89875b9cea12deaa84',
  '2026-09-05.md': '2e2421f5927290ba04994f2ee32a1793e25d915765e7c2ccfaff0251a8985e57',
  '2026-09-04.md': 'e1a328fb320baff3f39276df5dfcab74f54a817a3622d7f03fa8da953e32e4ac',
  '2026-09-03.md': '87a1985b26085b4aaa6292ba72b353067a5497994d171ec993c53e091f4f84c6',
  '2026-09-02.md': '5227cfca84ce048b10995e469f507839c21c7b6c354feddf7f9cb56a15d9798c',
  '2026-08-24.md': 'ccdc71eb45bc1ab63c67ccdd1fab415919f6ac0c6cc90a90765928d6f7c5bae7',
  '2026-08-23.md': '017e73e2464b66daa7a291d9d306ff4cf2921ca41c9b8e75b88c50560bb5cff8',
  '2026-08-15.md': 'b08d3db16144a87bd0c2e887ecb127df6f69858042757b91316ec15eed88b110',
  '2026-08-14.md': '1b27580e301a271d442dbd9fcf27119e330cccc91fd0291851955ee9ca2c99e5',
  '2026-08-09.md': '1d1a3c276dacf30d8375b74fef8b60a4fc03b9a4d40584cc50cf2f5a5a97b79a',
  '2026-08-08.md': 'f192b9d5aa1749fa0b2a3189d95fc517a3b3fa5e8ef01646bb218b6bbd24ad53',
  '2026-07-29.md': '67a313b81ea8e35be4ef6087548459f109fe70dc78a6bb4cbc2d8ab50e0bc98b',
  '2026-07-28.md': 'eaa7175e5da54c3cd068d45b11579f744232ca4351074c38c4e17c2f77904285',
  '2026-07-25.md': '721eeb6bafbc1b3944185fb47e1941991224b90c62224e78af2c60fac612bd0a',
};
const MOVED_FILES = Object.keys(FROZEN);

/**
 * Characters that make git call the file binary (NUL and the other C0 controls), or that reorder text on screen (bidi
 * controls), plus C1 controls, DEL and a stray BOM. Built from code points: the editing tools in this repo's sessions
 * decode backslash-u escapes inside file content.
 */
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const FORBIDDEN = new Set(
  [...range(0x00, 0x08), 0x0b, 0x0c, ...range(0x0e, 0x1f), 0x7f, ...range(0x80, 0x9f), 0x200e, 0x200f,
    ...range(0x202a, 0x202e), ...range(0x2066, 0x2069), 0xfeff].map((c) => String.fromCodePoint(c)),
);

/** A line (after a bullet's `- ` or a continuation's indent) that would open another Markdown block. */
const OPENS_BLOCK = /^(?:#|>|<|```|~~~|\||[-*+](?:\s|$)|\d{1,9}[.)](?:\s|$)|\[[^\]]*\]:|=+\s*$|(?:[-_*]\s*){3,}$)/;

/** What the moved-titles index must be: per moved file, newest first, its date and file, then its `###` titles. */
function deriveMovedIndex(): string {
  const out: string[] = [];
  for (const name of MOVED_FILES) {
    out.push('', `### ${name.replace(/\.md$/, '')} — 전문 \`docs/history/${name}\``, '');
    for (const line of readText(join(historyDir, name)).split('\n')) {
      if (line.startsWith('### ')) out.push(`- ${line.slice(4)}`);
    }
  }
  return out.join('\n').replace(/^\n+/, '').trimEnd();
}

const isRealDate = (d: string) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);

describe('CHANGELOG.md stays an index', () => {
  const marker = lines.findIndex((l) => l.trimEnd() === MOVED_INDEX);
  const firstH2 = lines.findIndex((l) => l.startsWith('## '));

  it('stays within one read', () => {
    expect(lines.length, `CHANGELOG.md is over ${MAX_LINES} lines`).toBeLessThanOrEqual(MAX_LINES);
    expect(
      Buffer.byteLength(changelog),
      `CHANGELOG.md is over ${MAX_BYTES} bytes — no longer one read. Old entries have to move out again; decide how `
      + 'with the owner (docs/specs/2026-10-09-changelog-index-design.md is the precedent), then update this test.',
    ).toBeLessThanOrEqual(MAX_BYTES);
  });

  it('has no BOM and no control or bidi characters', () => {
    expect(readFileSync(changelogPath, 'utf8').startsWith(BOM), 'CHANGELOG.md starts with a UTF-8 BOM — save it without one').toBe(false);
    const found = [...new Set([...changelog].filter((ch) => FORBIDDEN.has(ch)))].map((ch) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`);
    expect(found, 'CHANGELOG.md holds characters that make git treat it as binary or that reorder text on screen').toEqual([]);
  });

  it('keeps its preamble — the rules and the redirect — unchanged unless on purpose', () => {
    expect(
      sha256(lines.slice(0, firstH2).join('\n')),
      'the CHANGELOG.md preamble changed. Pointers in other docs, frozen release notes included, rely on its redirect '
      + '(dates, titles, and which entry a bare item number belongs to). If the change is deliberate, re-check that '
      + 'mapping against docs/specs/2026-10-09-changelog-index-design.md and update PREAMBLE_SHA256.',
    ).toBe(PREAMBLE_SHA256);
  });

  it('has the moved-titles index exactly once, after the new entries', () => {
    expect(marker, `CHANGELOG.md lost its "${MOVED_INDEX}" heading`).toBeGreaterThanOrEqual(firstH2);
    expect(lines.filter((l) => l.trimEnd() === MOVED_INDEX).length, `"${MOVED_INDEX}" appears more than once`).toBe(1);
  });

  it('lists exactly the dates and titles of the moved entries, newest first', () => {
    expect(
      lines.slice(marker + 1).join('\n').replace(/^\n+/, '').trimEnd(),
      'the moved-titles index must equal what docs/history/ derives to (each file\'s date, then its `###` titles). '
      + 'Pointers elsewhere find their date and file through it, so a moved title is an anchor, not a summary — '
      + 'do not edit, reorder, indent or annotate it here.',
    ).toBe(deriveMovedIndex());
  });

  it('keeps new entries to short bullets under real dates, newest first', () => {
    const bad: string[] = [];
    let date: string | null = null;
    let bulletsUnderDate = 0;
    let bullet: string[] | null = null;
    const closeBullet = () => {
      if (!bullet) return;
      const text = bullet.map((l) => l.trim()).join(' ').replace(/^- /, '').normalize('NFC');
      const n = [...text].length;
      if (n > MAX_ENTRY_CODE_POINTS) bad.push(`${n} code points (max ${MAX_ENTRY_CODE_POINTS}): ${JSON.stringify(text.slice(0, 50))}…`);
      bullet = null;
    };
    const closeDate = () => {
      closeBullet();
      if (date !== null && bulletsUnderDate === 0) bad.push(`"## ${date}" has no bullet`);
    };
    for (const line of lines.slice(firstH2, marker)) {
      const heading = /^## (\d{4}-\d{2}-\d{2})$/.exec(line);
      if (heading) {
        closeDate();
        const d = heading[1];
        if (!isRealDate(d) || d < FIRST_NEW_DATE || d > LAST_PLAUSIBLE_DATE) {
          bad.push(`not a real date from ${FIRST_NEW_DATE} on: ${JSON.stringify(line)}`);
        } else if (date !== null && !(d < date)) {
          bad.push(`"## ${d}" is not older than the "## ${date}" above it (newest first, one heading per date)`);
        }
        date = d;
        bulletsUnderDate = 0;
      } else if (/^- \S/.test(line) && date !== null) {
        closeBullet();
        if (OPENS_BLOCK.test(line.slice(2)) || line.includes('<!--')) bad.push(`a bullet must be plain text: ${JSON.stringify(line.slice(0, 60))}`);
        bullet = [line];
        bulletsUnderDate++;
      } else if (bullet && /^(?: {2,}|\t)\S/.test(line)) {
        if (OPENS_BLOCK.test(line.trimStart()) || line.includes('<!--')) bad.push(`a continuation line must be plain text: ${JSON.stringify(line.slice(0, 60))}`);
        bullet.push(line);
      } else if (line.trim() === '') {
        closeBullet();
      } else {
        bad.push(`not a date heading, a bullet or a continuation indented by two spaces or a tab: ${JSON.stringify(line.slice(0, 60))}`);
      }
    }
    closeDate();
    expect(
      bad,
      'above the moved-titles index, CHANGELOG.md holds only "## YYYY-MM-DD" headings (newest first) and "- " bullets of '
      + `at most ${MAX_ENTRY_CODE_POINTS} code points in plain text, continuation lines indented by two spaces or a tab — `
      + 'the account goes to its source (release note, docs/09 §5, docs/10, docs/specs, CLAUDE.md), not here',
    ).toEqual([]);
  });
});

describe('docs/history is the frozen copy of the moved entries', () => {
  it('holds exactly the files moved on 2026-10-09', () => {
    const present = readdirSync(historyDir).filter((n) => !OS_CLUTTER.has(n)).sort().reverse();
    expect(
      present,
      'docs/history/ holds only the files moved out of CHANGELOG.md on 2026-10-09 — new history is a CHANGELOG.md bullet '
      + 'pointing at its source, not a new file (or folder, or dotfile) here',
    ).toEqual(MOVED_FILES);
  });

  it('has not changed since the move', () => {
    const withBom = MOVED_FILES.filter((name) => readFileSync(join(historyDir, name), 'utf8').startsWith(BOM));
    expect(withBom, 'a moved file gained a UTF-8 BOM — save it without one').toEqual([]);
    const changed = MOVED_FILES.filter((name) => sha256(readText(join(historyDir, name))) !== FROZEN[name]);
    expect(
      changed,
      'docs/history/ is the verbatim copy moved out of CHANGELOG.md on 2026-10-09 and is not edited (CHANGELOG.md '
      + 'preamble). A correction is a deliberate exception: update FROZEN in the same commit and say why.',
    ).toEqual([]);
  });
});
