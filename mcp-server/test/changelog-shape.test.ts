/**
 * CHANGELOG.md is an INDEX, not a diary (2026-10-09, owner request). It had grown to 3,099 lines / 326,575 bytes — one
 * release's entry alone was 91,734, almost all of it review-round diary — and the file reader an agent uses returns at
 * most 2,000 lines and about 25,000 tokens per call, so no session could read it whole. Its 106 entries moved byte for
 * byte to docs/history/<work date>.md and the index kept their dates and titles. Design, the Grok rounds and the review
 * that shaped these checks: docs/specs/2026-10-09-changelog-index-design.md.
 *
 * What is asserted, exactly:
 *  - the whole file stays within one read (bytes and lines) and carries no BOM and no `\p{Cc}`/`\p{Cf}` character
 *    (controls, zero-width and bidi characters, the tag block) except a tab;
 *  - the preamble — the rules and the redirect that pointers elsewhere ("CHANGELOG.md v0.2.35", "CHANGELOG 57", frozen
 *    release notes included) rely on — is pinned by hash, so it changes only on purpose;
 *  - between the preamble and the moved-titles index there are only `## YYYY-MM-DD` headings (real dates from
 *    2026-10-09 on, newest first) and, under each, one-line `- ` entries of at most MAX_ENTRY_CODE_POINTS (NFC) that do
 *    not start like another Markdown block, name no block-level HTML tag and no character reference anywhere (backticks
 *    included — no parse to fool), and, read with CommonMark's inline rules, hold no other raw HTML, image, `$$` or `~`
 *    pair GitHub strikes through. One line, because review rounds 2-3 kept finding a way for a
 *    wrapped continuation to become a heading or a table on GitHub (setext underlines, delimiter rows, a one-space
 *    indent); a single line leaves no room for those, and the inline checks cover what fits on one line;
 *  - the moved-titles index equals what docs/history/ derives to: per file, its date and file, then its `###` titles;
 *  - docs/history/ holds exactly the moved files (OS clutter files aside), each pinned by hash.
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

/** The preamble's last line; the preamble is everything from the top through it. */
const PREAMBLE_END = '`mcp-server/test/changelog-shape.test.ts`가 지킨다.';
/** sha256 of the preamble, LF, lines joined by '\n'. */
const PREAMBLE_SHA256 = '7649742a1734831450d6f002cb9a4a073474c3939adeb239bbb320c4951d8da3';
/** Separates new entries (above) from the titles of the moved ones (below). */
const MOVED_INDEX = '## 옮긴 항목 색인 — 2026-07-25 ~ 2026-10-09';
/** About two sentences, on one line. Anything longer belongs in the source the entry points at. */
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
 * Characters that make git call the file binary (`\p{Cc}`: C0/C1 controls and DEL; a tab is allowed), or that are
 * invisible or reorder text on screen while an agent reading the file still sees them (`\p{Cf}`: bidi controls,
 * zero-width characters, a stray BOM, the U+E0000 tag block — review round 4).
 */
const INVISIBLE = /[\p{Cc}\p{Cf}]/u;

/**
 * What an entry's text may not start with: each would make the bullet hold another block on GitHub — an ATX heading
 * (`#` then a space; `#171` stays text), a quote, a fence or math block, a nested list, a task-list box, a thematic
 * break, an HTML block (`<` then a tag-ish character; autolinks aside), a footnote definition, or a whole-line link
 * reference definition (`[label]: destination "title"`, escaped brackets allowed in the label — so `[변경]: 설명` is a
 * definition GitHub hides, while `[변경]: 색인을 한 줄로 바꿨다` is text). A `<` at the start followed by a letter, `/`, `!`
 * or `?` is refused even where GitHub would show text (`<GROK_HOME>을 …`) — the safe side; autolinks and `<5분` pass.
 */
const BLOCK_START = /^(?:#{1,6}(?:\s|$)|>|```|~~~|\$\$|[-*+](?:\s|$)|\d{1,9}[.)](?:\s|$)|\[[\sxX]\](?:\s|$)|(?:[-_*]\s*){3,}$|<[A-Za-z/!?]|\[\^[^\]]+\]:|\[(?:[^\]\\]|\\.)+\]:\s*(?:<[^>]*>|\S+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$)/;

/** CommonMark's pieces for deciding what is literal inside a line (spec 0.31: escapes, autolinks, raw HTML, links). */
const ASCII_PUNCT = /[!-/:-@[-`{-~]/;
const AUTOLINK = /^<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/;
/** A tag GitHub renders (so `<GROK_HOME>`, `A<B`, `Map<string, number>` stay text), a comment opener, PI, declaration, CDATA. */
const HTML_TAG = /^(?:<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>|<!--|<\?[\s\S]*?\?>|<![A-Za-z][^>]*>|<!\[CDATA\[)/;
const LINK_TAIL = /^\(\s*(?:<(?:[^<>\n\\]|\\.)*>|(?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))+)?(?:\s+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\)))?\s*\)/;
const CHAR_REF = /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/;
/**
 * HTML whose effect can reach past its own entry — refused anywhere in the raw line, inside backticks too: tags that
 * fold (`details`), move (`div`, tables, lists and their closing tags) or fake (headings, `hr`) the rest of the page;
 * formatting elements an HTML parser reopens in every later block when left unclosed (`a`, `b`, `s`, `strike`, `code`,
 * `em`, `i`, `strong`, `u`, `tt`, `big`, `small`, `font`, `nobr` — an unclosed `<s>` would strike the whole moved index);
 * and elements that swallow what follows (`select`, `option`, `xmp`, `plaintext`, `listing`, `noscript`, `noembed`,
 * `noframes`, `title`, `svg`, `math`). No parse: review round 7 showed every imitation of GitHub's inline precedence
 * still disagrees with it somewhere (a bare URL with no boundary, a nested link, parentheses two deep), and each
 * disagreement let a `<details>` past a parse-based check and fold the moved index. With this check a disagreement can
 * only mis-render inline text inside one entry. A tag needs its `>` (`A<B 순` is text); placeholders such as `<pkg>`,
 * `<cwd>` or `<GROK_HOME>` are not on the list. A tag at the very start of an entry is BLOCK_START's job.
 */
const STRUCTURAL_HTML = /<\/?(?:details|summary|div|table|thead|tbody|tfoot|tr|td|th|caption|colgroup|col|ol|ul|li|dl|dt|dd|blockquote|p|pre|h[1-6]|hr|figure|figcaption|section|article|aside|nav|header|footer|main|address|iframe|object|embed|applet|script|style|textarea|template|dialog|form|fieldset|center|body|html|head|frameset|frame|a|b|big|code|em|font|i|nobr|s|small|strike|strong|tt|u|select|option|optgroup|xmp|plaintext|listing|noscript|noembed|noframes|title|svg|math|marquee|keygen)(?:\s[^<>]*)?\/?>/i;

/**
 * The length of a GFM extended autolink (a bare URL) starting at `i`, or 0 — cmark-gfm's rules, as far as they decide
 * which `~` and backticks belong to the URL: a scheme (`http`, `https`, `ftp`, any case) needs no boundary before it,
 * `www.` needs the line start, an ASCII space or `*_~(`; the domain must start with a letter or digit and its last two
 * labels may not hold `_`; the link runs to whitespace or `<`, then drops trailing `?!.,:*_~'"`, an unbalanced `)` and a
 * trailing entity-like `&name;` (review rounds 6-7).
 */
function extendedAutolinkLength(s: string, i: number): number {
  const rest = s.slice(i);
  const scheme = /^(?:https?|ftp):\/\//i.exec(rest);
  const www = !scheme && /^www\./i.test(rest) && (i === 0 || /[ \t*_~(]/.test(s[i - 1]));
  if (!scheme && !www) return 0;
  const domain = /^[A-Za-z0-9][A-Za-z0-9._-]*/.exec(rest.slice(scheme ? scheme[0].length : 0));
  if (!domain || domain[0].split('.').slice(-2).some((label) => label.includes('_'))) return 0;
  let end = 0;
  while (end < rest.length && !/[\s<]/.test(rest[end])) end += 1;
  for (;;) {
    const last = rest[end - 1];
    const entity = /&[A-Za-z0-9]+;$/.exec(rest.slice(0, end));
    if (last !== undefined && `?!.,:*_~'"`.includes(last)) end -= 1;
    else if (last === ';' && entity) end -= entity[0].length;
    else if (last === ')' && (rest.slice(0, end).match(/\)/g) ?? []).length > (rest.slice(0, end).match(/\(/g) ?? []).length) end -= 1;
    else break;
  }
  return end;
}

/**
 * Walks an entry the way CommonMark's inline parser decides what is literal, so the checks see what GitHub renders: a
 * backslash before ASCII punctuation escapes it; a run of N backticks opens a code span only if a run of exactly N
 * follows; at `<` an autolink or raw HTML starts; `](` after an open `[` takes a link destination and title — whichever
 * starts first wins. Review round 4 found a looser code-span regex, a backtick inside an autolink and one inside a link
 * destination each hiding a `<details>` that GitHub rendered, folding the whole moved index. Returns the first raw HTML
 * (or null), the text outside escapes, code spans, autolinks and link destinations, and where that text's `~`s sit in
 * the line — in groups, because GitHub never pairs a `~` inside a link's text with one outside it (review round 6).
 * Runs on the raw line, not NFC: NFC turns U+1FEF into a backtick that GitHub never sees.
 */
function scanInline(s: string): { html: string | null; visible: string; tildeGroups: number[][] } {
  let visible = '';
  const tildes: number[] = [];
  const linkTexts: number[][] = [];
  const opens: number[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && ASCII_PUNCT.test(s[i + 1])) {
      visible += ' ';
      i += 2;
    } else if (c === '`') {
      let j = i;
      while (s[j] === '`') j += 1;
      let close = -1;
      for (let k = j; k < s.length && close < 0;) {
        if (s[k] === '`') {
          let m = k;
          while (s[m] === '`') m += 1;
          if (m - k === j - i) close = k;
          k = m;
        } else {
          k += 1;
        }
      }
      visible += close < 0 ? s.slice(i, j) : ' ';
      i = close < 0 ? j : close + (j - i);
    } else if (c === '<') {
      const auto = AUTOLINK.exec(s.slice(i));
      const tag = auto ? null : HTML_TAG.exec(s.slice(i));
      if (tag) return { html: tag[0], visible, tildeGroups: [tildes, ...linkTexts] };
      visible += auto ? ' ' : c;
      i += auto ? auto[0].length : 1;
    } else if (c === ']' && opens.length > 0) {
      const start = opens.pop()!;
      const tail = s[i + 1] === '(' ? LINK_TAIL.exec(s.slice(i + 1)) : null;
      if (tail) linkTexts.push(tildes.splice(start));
      visible += c;
      i += 1 + (tail ? tail[0].length : 0);
    } else if ((c === 'h' || c === 'H' || c === 'f' || c === 'F' || c === 'w' || c === 'W') && extendedAutolinkLength(s, i) > 0) {
      visible += ' ';
      i += extendedAutolinkLength(s, i);
    } else {
      if (c === '[') opens.push(tildes.length);
      if (c === '~') tildes.push(i);
      visible += c;
      i += 1;
    }
  }
  return { html: null, visible, tildeGroups: [tildes, ...linkTexts] };
}

/**
 * Whether GitHub would pair two of these `~` runs into strikethrough: an opener run that is left-flanking, a later closer
 * run of the same length (one or two tildes) that is right-flanking — CommonMark's delimiter rules, which GFM's
 * strikethrough uses, with its notion of punctuation (ASCII punctuation and Unicode P, not symbols: `20℃~30℃, 40℃~50℃`
 * strikes). So `A50~A57, A59~A60` strikes the text between, while a spaced range (`2026-07-25 ~ 2026-10-09`, the moved
 * index's own heading) or `~/.grok … ~/.claude` does not (review rounds 5-6). Flanking is read on the raw line.
 */
function strikesThrough(s: string, tildes: number[]): boolean {
  const space = (ch: string | undefined) => ch === undefined || /\s/u.test(ch);
  const punct = (ch: string | undefined) => ch !== undefined && (ASCII_PUNCT.test(ch) || /\p{P}/u.test(ch));
  const runs: { len: number; left: boolean; right: boolean }[] = [];
  for (let k = 0; k < tildes.length;) {
    let m = k;
    while (m + 1 < tildes.length && tildes[m + 1] === tildes[m] + 1) m += 1;
    const before = s[tildes[k] - 1];
    const after = s[tildes[m] + 1];
    runs.push({
      len: m - k + 1,
      left: !space(after) && (!punct(after) || space(before) || punct(before)),
      right: !space(before) && (!punct(before) || space(after) || punct(after)),
    });
    k = m + 1;
  }
  return runs.some((open, a) => open.left && open.len <= 2 && runs.slice(a + 1).some((close) => close.right && close.len === open.len));
}

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
const at = (i: number) => `CHANGELOG.md:${i + 1}`;

describe('CHANGELOG.md stays an index', () => {
  const preambleEnd = lines.indexOf(PREAMBLE_END);
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

  it('has no BOM and no control or invisible formatting characters', () => {
    expect(readFileSync(changelogPath, 'utf8').startsWith(BOM), 'CHANGELOG.md starts with a UTF-8 BOM — save it without one').toBe(false);
    const found = lines.flatMap((line, i) => [...new Set([...line].filter((ch) => ch !== '\t' && INVISIBLE.test(ch)))]
      .map((ch) => `${at(i)} U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`));
    expect(found, 'CHANGELOG.md holds control or invisible formatting characters (git may call it binary; a reader sees text GitHub hides) — delete them').toEqual([]);
  });

  it('keeps its preamble — the rules and the redirect — unchanged unless on purpose', () => {
    expect(preambleEnd, `the preamble's last line ("${PREAMBLE_END}") is gone`).toBeGreaterThan(0);
    expect(
      sha256(lines.slice(0, preambleEnd + 1).join('\n')),
      'the CHANGELOG.md preamble changed. Pointers in other docs, frozen release notes included, rely on its redirect '
      + '(dates, titles, and which entry a bare item number belongs to). If the change is deliberate, re-check that '
      + 'mapping against docs/specs/2026-10-09-changelog-index-design.md and update PREAMBLE_SHA256.',
    ).toBe(PREAMBLE_SHA256);
    const stray = lines.slice(preambleEnd + 1, firstH2).map((l, i) => [l, preambleEnd + 1 + i] as const).filter(([l]) => l.trim() !== '');
    expect(
      stray.map(([l, i]) => `${at(i)} ${JSON.stringify(l.slice(0, 40))}`),
      'text between the preamble and the first "## YYYY-MM-DD" heading — an entry goes under a date heading',
    ).toEqual([]);
  });

  it('has the moved-titles index exactly once, after the new entries', () => {
    expect(marker, `CHANGELOG.md lost its "${MOVED_INDEX}" heading`).toBeGreaterThanOrEqual(firstH2);
    expect(lines.filter((l) => l.trimEnd() === MOVED_INDEX).length, `"${MOVED_INDEX}" appears more than once`).toBe(1);
  });

  it('lists exactly the dates and titles of the moved entries, newest first', () => {
    expect(
      lines.slice(marker + 1).join('\n').replace(/^\n+/, '').trimEnd(),
      'the moved-titles index must equal what docs/history/ derives to (each file\'s date, then its `###` titles). '
      + 'A new entry goes ABOVE it, under "## YYYY-MM-DD". A moved title is an anchor that pointers elsewhere find their '
      + 'date and file through, not a summary — do not edit, reorder, indent or annotate it.',
    ).toBe(deriveMovedIndex());
  });

  it('keeps new entries to one plain line each, under real dates, newest first', () => {
    const bad: string[] = [];
    let date: string | null = null;
    let entries = 0;
    const closeDate = () => {
      if (date !== null && entries === 0) bad.push(`"## ${date}" has no entry`);
    };
    lines.slice(firstH2, marker).forEach((line, k) => {
      const i = firstH2 + k;
      const heading = /^## (\d{4}-\d{2}-\d{2})\s*$/.exec(line);
      if (heading) {
        closeDate();
        const d = heading[1];
        if (!isRealDate(d) || d < FIRST_NEW_DATE || d > LAST_PLAUSIBLE_DATE) {
          bad.push(`${at(i)} not a real date from ${FIRST_NEW_DATE} on: ${JSON.stringify(line)}`);
        } else if (date !== null && !(d < date)) {
          bad.push(`${at(i)} "## ${d}" is not older than the "## ${date}" above it (newest first, one heading per date)`);
        }
        date = d;
        entries = 0;
      } else if (/^[ \t]*$/.test(line)) {
        // blank lines separate headings and entries; a line holding an NBSP is not blank (four spaces and an NBSP
        // render a code block)
      } else if (date !== null && /^- \S/.test(line)) {
        entries++;
        const text = line.slice(2).trimEnd();
        const n = [...text.normalize('NFC')].length;
        const show = JSON.stringify(text.slice(0, 40));
        if (n > MAX_ENTRY_CODE_POINTS) bad.push(`${at(i)} ${n} code points (max ${MAX_ENTRY_CODE_POINTS}) — say less, point at the source`);
        if (BLOCK_START.test(text) && !AUTOLINK.test(text)) bad.push(`${at(i)} starts like another Markdown block (heading, quote, list, box, rule, definition, HTML) — reword, or escape the first character with a backslash: ${show}`);
        const { html, visible, tildeGroups } = scanInline(text);
        const structural = STRUCTURAL_HTML.exec(text);
        if (structural) bad.push(`${at(i)} names an HTML tag that can reach past its entry ${JSON.stringify(structural[0])} — refused even in backticks (it could fold, move or restyle the index); describe it without angle brackets: ${show}`);
        if (html) bad.push(`${at(i)} holds raw HTML ${JSON.stringify(html.slice(0, 20))} — put it in backticks or drop it: ${show}`);
        if (CHAR_REF.test(text)) bad.push(`${at(i)} holds a character reference — write the character itself (refused even in backticks): ${show}`);
        if (visible.includes('![')) bad.push(`${at(i)} holds an image — link to it instead: ${show}`);
        if (visible.includes('$$')) bad.push(`${at(i)} holds display math ($$) — put it in backticks: ${show}`);
        if (tildeGroups.some((group) => strikesThrough(text, group))) bad.push(`${at(i)} has "~" that GitHub pairs into strikethrough — space a range's "~" (A50 ~ A57), escape it as \\~, or put it in backticks: ${show}`);
      } else {
        bad.push(`${at(i)} not a "## YYYY-MM-DD" heading or a one-line "- " entry (one space after the dash, no wrapped continuation): ${JSON.stringify(line.slice(0, 40))}`);
      }
    });
    closeDate();
    expect(
      bad,
      'above the moved-titles index, CHANGELOG.md holds only "## YYYY-MM-DD" headings (newest first) and one-line "- " '
      + `entries of at most ${MAX_ENTRY_CODE_POINTS} code points, plain text — the account goes to its source (release `
      + 'note, docs/09 §5, docs/10, docs/specs or docs/plans, CLAUDE.md), not here',
    ).toEqual([]);
  });
});

describe('docs/history is the frozen copy of the moved entries', () => {
  it('holds exactly the files moved on 2026-10-09', () => {
    const present = readdirSync(historyDir, { withFileTypes: true })
      .filter((e) => !(e.isFile() && OS_CLUTTER.has(e.name)))
      .map((e) => e.name)
      .sort()
      .reverse();
    expect(
      present,
      'docs/history/ holds only the files moved out of CHANGELOG.md on 2026-10-09 — new history is a CHANGELOG.md entry '
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
      + 'preamble) — a correction is a new CHANGELOG.md entry pointing at its source. Restore the file.',
    ).toEqual([]);
  });
});
