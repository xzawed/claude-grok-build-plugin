/**
 * CHANGELOG.md is an INDEX, not a diary (2026-10-09, owner request). It had grown to 3,099 lines / 330 KB — one
 * release's review diary alone was 92 KB — past the 2,000 lines an agent's file reader returns in one call, so no
 * session could read it whole. Its 106 entries moved byte for byte to docs/history/<work date>.md (one file per work
 * date, the largest about 700 lines) and the index kept their dates and titles. Design, the two Grok rounds and the
 * alternatives they rejected: docs/specs/2026-10-09-changelog-index-design.md.
 *
 * What keeps it an index:
 *  - the preamble stays short and keeps the redirect a pointer elsewhere relies on — "CHANGELOG.md v0.2.35" or
 *    "CHANGELOG 57" in another doc (frozen release notes included) finds its date, then its file, through it;
 *  - above the moved-titles index an entry is ONE bullet of at most MAX_ENTRY_CODE_POINTS under a `## <date>`;
 *  - the moved-titles index is exactly what the history files derive to (dates and `###` titles, newest first);
 *  - docs/history/ is the frozen copy: one pinned hash per file, no file added or removed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const lf = (s: string) => s.replace(/\r\n/g, '\n');
const changelog = lf(readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8'));
const historyDir = join(repoRoot, 'docs/history');
const history = readdirSync(historyDir)
  .filter((n) => n.endsWith('.md'))
  .sort()
  .reverse()
  .map((name) => ({ name, text: lf(readFileSync(join(historyDir, name), 'utf8')) }));

/** Separates new entries (above) from the titles of the moved ones (below). */
const MOVED_INDEX = '## 옮긴 항목 색인 — 2026-07-25 ~ 2026-10-09';
/** About two wrapped lines. Anything longer belongs in the source the bullet points at. */
const MAX_ENTRY_CODE_POINTS = 300;
const MAX_PREAMBLE_LINES = 20;
/** The file reader's limit per call — the reason for the move. */
const ONE_READ = 2000;

/**
 * The redirect, whitespace-collapsed. The second clause is round 2's catch: the first draft read every bare number as a
 * v0.2.36 item, but docs/releases/v0.2.37.md cites ITS entry's items 13, 14 and 19 — v0.2.36's are other paragraphs.
 */
const REDIRECT_CLAUSES = [
  '전문은 `docs/history/<작업일>.md`에 같은 제목으로, 글자 그대로 있다',
  '`docs/releases/v0.2.36-review.md`·`docs/09`의 번호는 v0.2.36 항목, `docs/releases/v0.2.37.md`의 번호는 v0.2.37 항목',
];

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

const lineCount = (text: string) => text.split('\n').length - (text.endsWith('\n') ? 1 : 0);

/** What the moved-titles index must be: per history file, its date heading, then one bullet per `###` title. */
function deriveMovedIndex(): string {
  const out: string[] = [];
  for (const { name, text } of history) {
    out.push('', `### ${name.replace(/\.md$/, '')} — 전문 \`docs/history/${name}\``, '');
    for (const line of text.split('\n')) if (line.startsWith('### ')) out.push(`- ${line.slice(4)}`);
  }
  return `${out.join('\n').replace(/^\n+/, '')}\n`;
}

describe('CHANGELOG.md stays an index', () => {
  const at = changelog.indexOf(`\n${MOVED_INDEX}\n`);
  const firstDate = changelog.search(/^## /m);

  it('is one read', () => {
    expect(lineCount(changelog), `CHANGELOG.md is over ${ONE_READ} lines`).toBeLessThanOrEqual(ONE_READ);
  });

  it('keeps a short preamble that carries the redirect', () => {
    expect(firstDate, 'CHANGELOG.md has no `## ` section').toBeGreaterThan(0);
    const preamble = changelog.slice(0, firstDate);
    expect(lineCount(preamble), `the preamble is over ${MAX_PREAMBLE_LINES} lines — rules, not history`).toBeLessThanOrEqual(
      MAX_PREAMBLE_LINES,
    );
    const flat = preamble.replace(/\s+/g, ' ');
    expect(REDIRECT_CLAUSES.filter((c) => !flat.includes(c)), 'the preamble lost part of its redirect').toEqual([]);
  });

  it('has the moved-titles index exactly once, below every new entry', () => {
    expect(at, `CHANGELOG.md lost its "${MOVED_INDEX}" heading`).toBeGreaterThan(firstDate);
    expect(changelog.indexOf(MOVED_INDEX, at + 2), 'the moved-titles heading appears twice').toBe(-1);
  });

  it('lists exactly the dates and titles of the moved entries, newest first', () => {
    const below = changelog.slice(at + 1 + MOVED_INDEX.length + 1).replace(/^\n+/, '');
    expect(
      below,
      'the moved-titles index must equal what docs/history/ derives to — pointers elsewhere find their date and file '
      + 'through it. A moved title is an anchor, not a summary: do not edit it here.',
    ).toBe(deriveMovedIndex());
  });

  it('keeps every new entry to one short bullet under a date', () => {
    const bad: string[] = [];
    let bullet: string[] | null = null;
    const close = () => {
      if (!bullet) return;
      const text = bullet.map((l) => l.trim()).join(' ').replace(/^- /, '');
      const n = [...text].length;
      if (n > MAX_ENTRY_CODE_POINTS) bad.push(`${n} code points: ${text.slice(0, 60)}…`);
      bullet = null;
    };
    for (const line of changelog.slice(firstDate, at).split('\n')) {
      if (line.startsWith('- ')) {
        close();
        bullet = [line];
      } else if (line.startsWith('  ') && bullet) {
        bullet.push(line);
      } else {
        close();
        if (line !== '' && !/^## \d{4}-\d{2}-\d{2}$/.test(line)) bad.push(`not a date heading or a bullet: ${line.slice(0, 60)}`);
      }
    }
    close();
    expect(
      bad,
      `an entry is one bullet of at most ${MAX_ENTRY_CODE_POINTS} code points under "## YYYY-MM-DD" — the account `
      + 'goes to its source (release note, docs/09 §5, docs/10, docs/11), not here',
    ).toEqual([]);
  });
});

describe('docs/history is the frozen copy of the moved entries', () => {
  it('holds exactly the files moved on 2026-10-09', () => {
    expect(history.map((h) => h.name)).toEqual(Object.keys(FROZEN));
  });

  it('has not changed since the move', () => {
    const changed = history
      .filter(({ name, text }) => createHash('sha256').update(text).digest('hex') !== FROZEN[name])
      .map(({ name }) => name);
    expect(
      changed,
      'docs/history/ is the verbatim copy moved out of CHANGELOG.md on 2026-10-09 — new history is a CHANGELOG.md bullet '
      + 'pointing at its source. If a correction here is truly needed, update FROZEN in the same commit and say why.',
    ).toEqual([]);
  });
});
