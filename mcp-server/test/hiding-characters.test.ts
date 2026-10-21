/**
 * No tracked file, and no tracked path, holds a character that hides text from the person reading it: a bidirectional
 * control (the embeddings, overrides and isolates, and the three implicit marks), a Unicode tag character (U+E0000 to
 * U+E007F, which can carry a whole sentence no one sees), or two variation selectors in a row (Unicode's
 * Variation_Selector set). SonarQube's text rules S6389, S7628 and S8522 look for these, but they read a Markdown file
 * only when the listed folder reaches it through a dot name (its own, or one below it; a folder named .github does not
 * count): naming the files of .claude one by one, so that the JavaScript analyzer reads .claude/tools, took the two
 * skills there out of those rules, and the plugin's own prompt files (skills, commands, agents) were never in them
 * (measured 2026-10-18 — docs/09-scope-and-residuals.md §4 H). So this reads every tracked file on every run, whether
 * SonarQube Cloud analyzes the repository or not — as the index holds it, from git's own objects, since a checkout can
 * hand over something else (round-3 review of #181 hid a sentence behind the `ident` attribute that way), and as the
 * checkout holds it besides, since an edit not yet staged shows only there (round 4). It is stricter than those rules
 * on purpose: S6389 passed an override closed on the same line (measured the same day), and S8522 is about runs of
 * selectors where this flags any two. One variation selector after a character is ordinary — the warning sign these
 * documents use is U+26A0 U+FE0F. Other invisible characters are not looked for (round-7 review): a zero-width space or
 * joiner, a soft hyphen, a byte-order mark, or a line or paragraph separator (U+2028, U+2029 — round-13 review) passes
 * — the three kinds above are the ones those rules look for, and a zero-width joiner is part of many emoji. What it
 * cannot read whole fails it too, so that nothing passes unread: a file that is not UTF-8 text (an image, say — adding
 * one means deciding here how it is read), in the index or in the checkout (one git writes there in another encoding,
 * through `working-tree-encoding`, fails so where those bytes are not UTF-8 text — round-17 and round-18 reviews), a
 * tracked path the checkout holds as a folder and a path that is not UTF-8 are reported. So is what a reader may get in
 * place of what it read: the file behind a Git LFS pointer git-lfs takes, past any white space it skips and any
 * extension lines it takes in front, in the index or, where the index object is not one, in the checkout (a pointer's
 * file is not in the repository, and a plain clone with LFS writes it — round-5 review; a pointer behind white space —
 * round 17; behind extension lines, whose file only a cloner who configured that extension gets — round 18; one git
 * makes on checkout — round 19), and another platform's checkout of a path whose `working-tree-encoding`, as the index
 * or the checkout gives it, has git write it through iconv (each platform's iconv reads an encoding's name its own way
 * — rounds 22 and 23), but for the values "set" and "unset" spelled out (round 24). Erring toward reporting, so is
 * whatever else begins as a pointer does to `pointer`, which git-lfs takes for none — text that only begins so
 * (round 16), one behind a byte-order mark (round 17) or behind lines that only begin as extension lines
 * (rounds 18 and 19), and one the first 1024 bytes git-lfs reads cut short (round 22) — and an attributes file that
 * names that attribute at all, whatever another git or file system makes of it — the file that gives one of those two
 * values among them (rounds 24 and 25) — or that is a link, which a git before 2.32 follows (round 26). A submodule
 * (its files are another repository's), a checkout file it may not read or a folder it may not search, and an answer
 * from git of more than 256 MiB make it throw (Grok's falsification of round 5; the reviews of rounds 6, 8, 9).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync, type Stats,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NUL = String.fromCodePoint(0);
const TAB = String.fromCodePoint(9);
const NL = String.fromCodePoint(10);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
// this listing takes 256 MiB, as committed()'s and encodingNamed()'s calls do, so that it, like every call the scan
// makes, throws at the size the header names (round-9 review: this one took execFileSync's 1 MiB)
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 28 })
  .split(NUL).filter(Boolean);

const bidi = (cp: number) => (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)
  || cp === 0x200e || cp === 0x200f || cp === 0x061c;
const tag = (cp: number) => cp >= 0xe0000 && cp <= 0xe007f;
const VARIATION = new RegExp(`${String.fromCodePoint(92)}p{Variation_Selector}`, 'u');
const selector = (cp: number) => VARIATION.test(String.fromCodePoint(cp));
const name = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * Each hiding character in a text, as `line:column U+XXXX` (a column counts code points) — nothing when it has none.
 */
function hiding(text: string): string[] {
  const found: string[] = [];
  let line = 1;
  let column = 0;
  let previous = 0;
  for (const c of text) {
    const cp = c.codePointAt(0) ?? 0;
    column++;
    if (bidi(cp) || tag(cp) || (selector(cp) && selector(previous))) found.push(`${line}:${column} ${name(cp)}`);
    if (cp === 10) {
      line++;
      column = 0;
    }
    previous = cp;
  }
  return found;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });
/**
 * What a file's bytes hide, and how many of them were decoded: what `hiding` finds, or that they are not UTF-8 text,
 * which would keep such a character from this scan (Grok's review), so it fails too. UTF-16 holds NUL bytes once it
 * holds an ASCII character, and its byte-order mark is not valid UTF-8; UTF-16 of non-ASCII text alone, without the
 * mark, can still pass as UTF-8.
 */
function scan(bytes: Uint8Array): { decoded: number; found: string[] } {
  if (bytes.includes(0)) return { decoded: 0, found: ['not UTF-8 text: a NUL byte'] };
  try {
    return { decoded: bytes.length, found: hiding(utf8.decode(bytes)) };
  } catch {
    return { decoded: 0, found: ['not UTF-8 text: an invalid byte sequence'] };
  }
}

interface Tracked { path: string; bytes: Uint8Array }
interface Entry { oid: string; path: string }

/**
 * Every tracked file as the index holds it — what a commit takes — read through `git cat-file --batch`, with replace
 * refs ignored (round-4 review: `git replace` could hand the scan another object). A checkout can rewrite a file —
 * `ident`, `filter`, `working-tree-encoding`, line endings — and a symlink points elsewhere, but the object is what is
 * committed. The paths whose bytes are not UTF-8 are named too: read with U+FFFD in them, they match no file in the
 * checkout (round-6 review); and so are the paths the index holds as links (`attributesLinks`).
 */
function committed(root: string): { files: Tracked[]; unnamed: string[]; links: string[] } {
  const listing = execFileSync('git', ['ls-files', '-s', '-z'], { cwd: root, maxBuffer: 1 << 28 });
  const entries: Entry[] = [];
  const unnamed: string[] = [];
  const links: string[] = [];
  for (let at = 0; at < listing.length;) {
    const end = listing.indexOf(0, at) < 0 ? listing.length : listing.indexOf(0, at);
    const entry = listing.subarray(at, end);
    at = end + 1;
    const tab = entry.indexOf(9); // the path is everything after the first tab, a tab inside it included
    const [mode, oid] = entry.subarray(0, tab).toString('latin1').split(' ');
    const raw = entry.subarray(tab + 1);
    const path = raw.toString('utf8');
    try { utf8.decode(raw); } catch { unnamed.push(path); }
    if (mode === '120000') links.push(path);
    entries.push({ oid, path });
  }
  const out = execFileSync('git', ['--no-replace-objects', 'cat-file', '--batch'], {
    cwd: root, input: entries.map((e) => e.oid).join(NL) + NL, maxBuffer: 1 << 28,
  });
  return { files: objects(entries, out), unnamed, links };
}

/**
 * The files in git's answer to `cat-file --batch` for these entries, in order. Each object must be a blob under its
 * entry's id, exactly as long as git says and followed by a newline, and the answer must be used up. git's own answer
 * always is, so these checks are tried on answers built to fail them (round-5 review).
 */
function objects(entries: readonly Entry[], out: Buffer): Tracked[] {
  const files: Tracked[] = [];
  let at = 0;
  for (const { oid, path } of entries) {
    const end = out.indexOf(10, at);
    if (end < 0) throw new Error(`git cat-file left ${path} unanswered`);
    const [answered, type, size] = out.subarray(at, end).toString('utf8').split(' ');
    if (answered !== oid || type !== 'blob') throw new Error(`git cat-file answered "${answered} ${type}" for ${path}`);
    at = end + 1;
    const bytes = out.subarray(at, at + Number(size));
    if (bytes.length !== Number(size)) throw new Error(`git cat-file cut ${path} short`);
    if (out[at + Number(size)] !== 10) throw new Error(`git cat-file put no newline after ${path}`);
    files.push({ path, bytes });
    at += Number(size) + 1; // each object is followed by a newline
  }
  if (at !== out.length) throw new Error('git cat-file answered more than was asked');
  return files;
}

/** The lstat errors that mean nothing is there: no such file, a file where a folder should be, a name too long. */
const NOTHING_THERE = new Set(['ENOENT', 'ENOTDIR', 'ENAMETOOLONG']);
/**
 * What the checkout holds at a tracked path, a link not followed — nothing when no file is there, as when it was
 * removed and not yet staged (round-5 review: the scan failed on one) or left out of a sparse checkout (Grok's
 * falsification of round 5: git's own list of removed files leaves those out). Any other failure, a folder the scan may
 * not search say, is thrown, not taken for nothing there (round-6 review).
 */
function atPath(root: string, path: string, stat: (file: string) => Stats = lstatSync): Stats | undefined {
  try {
    return stat(join(root, path));
  } catch (err) {
    if (NOTHING_THERE.has((err as NodeJS.ErrnoException).code ?? '')) return undefined;
    throw err;
  }
}

/**
 * Every tracked path's file as the checkout holds it, where one is there: a regular file's bytes, and a link's own
 * text, the path it points to, as git stores it — never what it points to. An edit not yet staged shows only here, and
 * `npm test` runs before `git add` (round-4 review); a link re-pointed and not yet staged passed on Linux, where the
 * checkout writes a link, while win32's plain file showed it (round-6 review).
 */
function checkedOut(root: string, paths: readonly string[]): Tracked[] {
  return paths.flatMap((path) => {
    const at = atPath(root, path);
    if (at?.isFile()) return [{ path, bytes: readFileSync(join(root, path)) }];
    if (at?.isSymbolicLink()) return [{ path, bytes: readlinkSync(join(root, path), { encoding: 'buffer' }) }];
    return [];
  });
}

/** How many bytes of each file a scan decoded, in order, and what hides in their paths and contents. */
function foundIn(files: readonly Tracked[], where = ''): { read: [string, number][]; found: string[] } {
  const read: [string, number][] = [];
  const found = files.flatMap(({ path, bytes }) => {
    const { decoded, found: inside } = scan(bytes);
    read.push([path, decoded]);
    return [...hiding(path).map((h) => `${path}${where} (path): ${h}`), ...inside.map((h) => `${path}${where}: ${h}`)];
  });
  return { read, found };
}

// How the version lines of the pointers git-lfs reads begin: today's and two older ones (`git lfs pointer --check`
// takes all three, and `git lfs smudge` writes the file a hawser one stands for — git-lfs 3.5.1, round-6 review).
const LFS = ['version https://git-lfs.github.com/spec/', 'version https://hawser.github.com/spec/', 'version http://git-media.io/v/'];
// The white space git-lfs skips in front of one: it reads no more than an object's first 1024 bytes and trims them
// before it parses them, so a pointer behind white space is one still while what is left of it in those bytes parses.
// git-lfs 3.5.1 took one behind each character JavaScript's \s holds but the byte-order mark, and behind U+0085, which
// \s does not hold, and none behind a byte-order mark, U+180E, a zero-width space or U+2060 — so \s with U+0085 added
// skips what it skips, and a byte-order mark besides. A 127-byte pointer behind 898 spaces, 1025 bytes in all, was one
// still and smudged into its file; behind 899 the cut left a pointer it took but could not fetch, behind 900 none
// (round-17 review of #181 and Grok's falsification of its changes, measured again); the pointers the two LFS rows
// build are shorter and go further, as the comment on them says.
const LEADING_SPACE = /^[\s\x85]*/;
// The extension lines git-lfs takes in front of the version line too — a key `ext-<digit>-<name>`, a space and a value,
// with empty lines between — in a pointer whose file only a cloner who configured that extension gets (git-lfs 3.5.1
// took one, two, one with an empty line after it, one behind white space and a CRLF one; not one with a line of spaces
// between it and the version line, an `extx-` key, a key with no value, or `ext-10-` — round-18 review of #181,
// measured again). Lines git-lfs refuses that begin as extension lines are skipped too, erring toward reporting: a key
// with no value (round 18), and a non-oid value or two names with one number (both round 19, measured again).
const EXTENSION_LINES = /^(?:ext-\d-\w[^\n]*\n(?:\r?\n)*)*/;
/**
 * Whether an object begins as a Git LFS pointer does, after the white space git-lfs skips and a byte-order mark, which
 * it does not, and after any extension lines, in its first 1024 bytes, whatever its size. Text that only begins so is
 * reported too, and said to begin so: a pointer taken for text would pass with the file it stands for unread, so this
 * errs toward reporting (round-16 review of #181 — a document whose first line quoted a pointer's was reported as a
 * pointer).
 */
const pointer = (bytes: Uint8Array) => {
  const head = Buffer.from(bytes.subarray(0, 1024)).toString('utf8').replace(LEADING_SPACE, '')
    .replace(EXTENSION_LINES, '');
  return LFS.some((line) => head.startsWith(line));
};

/**
 * Whether git writes a checkout through iconv under this `working-tree-encoding` value: for every value but an unset
 * attribute, an empty value and UTF-8 in either of the two spellings git takes for it — and one set with no value,
 * which git refuses to add or check out (measured on Git for Windows 2.45.1 and glibc's git 2.39.5, round 23). An
 * attribute a path does not have — never given, or reset with `!` — `git check-attr --all` leaves out, so the word
 * "unspecified" comes here only as a value given, which git hands iconv too (measured). The words "set" and "unset" as
 * values print as the set and unset states do, so they are taken for those, though git hands them to iconv; no iconv
 * measured reads either, so git wrote such a file as the index holds it on Git for Windows, glibc and musl, and
 * `attributesNaming` reports the attributes file that gives one (round-24 review of #181, measured again).
 */
const throughIconv = (value: string) => !['unset', 'set', ''].includes(value) && !/^utf-?8$/i.test(value);

/**
 * The tracked paths whose `working-tree-encoding`, as `git check-attr` gives it from the index's attributes and from
 * the checkout's, is a value `throughIconv` takes. Each platform reads an encoding's name its own way: under `UCS2LE`,
 * glibc and Git for Windows wrote an index object put in by hand to the checkout as it was, plain text, and musl wrote
 * the tag characters it hid (round-22 review of #181, measured again) — so what this platform's checkout holds says
 * nothing of another's. Both sources count, since either can hide the other: a .gitattributes that names itself with
 * `UTF-7` is written to the checkout in UTF-7 by glibc and Git for Windows, where each `=` reads `+AD0-`, and as it is
 * by musl (round 23, measured again); and an edit not yet staged gives an attribute only the checkout holds. Each is
 * read with patterns matched whatever their case, as git matches them on Windows and macOS, and in it, as on Linux, and
 * a path either way names counts: under `X.MD`, Git for Windows wrote x.md through iconv where glibc's and musl's git
 * named nothing (round 24), and where a later `X.MD` turned the attribute off, glibc's and musl's git, matching case,
 * still handed x.md's checkout to iconv (round 25; both measured again). Replace refs are ignored, as the objects' read
 * ignores them (round 24: one hid the committed .gitattributes). git reads `$GIT_DIR/info/attributes`, the configured
 * attributes file, the system's (Git for Windows ships one, which gives `diff` alone here) and an untracked
 * .gitattributes in the checkout besides: each named a path the tracked files did not (the system's measured on glibc
 * and musl), and info/attributes, which git puts over every other, can hide one from both reads — though not the
 * tracked attributes file that gives it, which `attributesNaming` reports; a configured file and an untracked
 * .gitattributes that turned the attribute off hid nothing (rounds 24 and 25). And `attr.tree` or `GIT_ATTR_SOURCE`,
 * which git 2.45.1 and 2.54.0 read and 2.39.5 does not, gives the checkout's read, not the index's, a tree's attributes
 * in place of the checkout's: under an empty tree it named nothing an edit not yet staged named, and under one naming a
 * path it named that path (round 26) — the attributes file the edit is in reported all the same.
 */
function encodingNamed(root: string, paths: readonly string[]): string[] {
  const named = new Set<string>();
  for (const source of [['--cached'], []]) {
    for (const ignorecase of ['true', 'false']) {
      const out = execFileSync('git', ['--no-replace-objects', '-c', `core.ignorecase=${ignorecase}`, 'check-attr', ...source, '-z', '--stdin', '--all'], {
        cwd: root, input: paths.map((path) => path + NUL).join(''), maxBuffer: 1 << 28,
      }).toString('utf8').split(NUL); // each attribute a path has: the path, the attribute's name, its value
      for (let i = 0; i + 2 < out.length; i += 3) {
        if (out[i + 1] === 'working-tree-encoding' && throughIconv(out[i + 2])) named.add(out[i]);
      }
    }
  }
  return paths.filter((path) => named.has(path));
}

/**
 * The tracked attributes files that name `working-tree-encoding` at all, as the index or the checkout holds them —
 * whatever this git makes of them, since gits and file systems make different things of them (the reviews of rounds 24
 * and 25 of #181, measured again): git 2.39.5, 2.45.1 and 2.49.1 ignore a line of 2048 bytes or more, which git 2.36.3
 * applied on clone (the limit came with the security fix of git 2.30.7, which 2.36.4 and 2.39.1 merged — before it, its
 * notes say, git split such a line read from a file, but not one read from the index); where a file system takes two
 * spellings of a folder's name for one, the .gitattributes under one counts for the tracked folder under the other —
 * case on Windows (a/.gitattributes named A/x.md there, and nothing on glibc), and a Unicode normal form on macOS (the
 * reviewer's, with one folder mounted under both names); a `.GITATTRIBUTES` is read as one where case is not told
 * apart, and so is a `.gitattributeſ` where case is folded as Unicode folds it: the case-insensitive comparison of
 * names XNU gives file systems took ſ for s (its source, built and run here; APFS itself was not measured; round 26),
 * so a name is compared upper-cased and then lower-cased, which takes ı for i besides, erring toward reporting; and
 * HFS+ leaves U+200C to U+200F, U+202A to U+202E, U+206A to U+206F and U+FEFF out of a name it compares, which is why
 * git's own name check leaves them out too (`git fsck`, which reports a line too long for an attributes file, or one
 * that is a link, only under a name it takes for .gitattributes, took `.gitattributes` with any one of those sixteen in
 * it for one, and none with U+200B or U+00AD; HFS+ itself was not measured) — and Linux's case folding, in a folder
 * that has it, leaves out every code point Unicode 12.1 made default-ignorable, those sixteen, U+200B and U+00AD among
 * them (round-31 review of #181: a clone into such a folder, on Debian's kernels 6.1, 6.12 and 7.2, read a `.git` +
 * U+200B + `attributes` as .gitattributes, whose encoding the checkout's read then gave x.md, as a checkout of it
 * wrote; here, the kernel's source read so, and e2fsprogs's copy of its tables folded each one tried out of a name, and
 * not U+00A0, nor U+180F, which Unicode made default-ignorable only in 14.0). So a name is compared with every
 * default-ignorable code point left out, as the Unicode this node knows makes them, which holds all those, erring
 * toward reporting. On NTFS, Win32 took `.gitattributes` followed by periods and spaces, or by `::$DATA`, for
 * .gitattributes (cmd.exe wrote each to it, and `:x` to a stream beside an empty one; Git for Windows has refused such
 * a path since 2.24.1, and handed one to Win32 unchecked before, by its source), and Git for Windows 2.45.1, cloning
 * onto a volume that gave .gitattributes the 8.3 short name `GITATT~1`, wrote a tracked `GITATT~1` over it — the
 * checkout's read then gave x.md the encoding `GITATT~1` named, and the index's nothing (round 26). So a name is taken
 * as git's NTFS name check takes it too, with the default-ignorable code points left out of it as well, erring toward
 * reporting: `.gitattributes` with any periods and spaces after it and anything after a colon, and the short names that
 * check takes, at each length of the one NTFS falls back to (`git fsck` took each such name for one, a colon with
 * nothing or a line break after it too, and none of the names the NTFS row holds as not taken; rounds 26 to 32). And
 * Win32 takes a backslash for a folder's separator, so the part of a path after its last slash or backslash is
 * a name too: Git for Windows has refused to check out a path that holds a backslash since 2.24.1, under
 * `core.protectNTFS` — as a tree entry in 2.24.1 (its tree-walk.c), as an index entry from 2.25.0 on (its read-cache.c)
 * — and with that off, 2.45.1 cloned a tracked `docs\.gitattributes` to docs/.gitattributes and an `a\b\.gitattributes`
 * to a/b/.gitattributes, whose encodings the checkout's read then gave the x.md beside each (round-27 and round-28
 * reviews of #181). The part after the last slash is a name still, as git's NTFS check reads it whole: the `git fsck`
 * of each git measured took a `.gitattributes:x\y` for one, the name ending at its colon (round 28). And a name is
 * taken where what comes before its first backslash is `.gitattributes` itself, as Git for Windows's HFS check ends a
 * name at a folder separator, which a backslash is there: its `git fsck` took a `.gitattributes\x`, a
 * `.gitattributes\x\y` and, in a tree written as bytes, as its update-index refuses that name, a `.gitattributes\` for
 * one, in capitals and with one of the sixteen in them too, where glibc's did not, and neither took a
 * `.gitattributes.\x`, a `GITATT~1\x` or a `.gitattributes \x` (round-29 to round-31 reviews). Git for Windows 2.45.1,
 * cloning under `core.protectNTFS=false`, wrote neither a `.gitattributes\x` nor a `.gitattributes:x\y` and gave x.md
 * nothing; both are reported all the same, as names git's checks take. A line naming the attribute counts wherever it
 * is, a comment too, erring toward reporting as the pointer check does.
 */
const ATTRIBUTE = Buffer.from('working-tree-encoding');
// the code points left out of a name as the scan compares it: every default-ignorable one, those Linux's case folding
// leaves out (Unicode 12.1's) and HFS+'s sixteen among them
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;
// the names git's NTFS check (path.c, is_ntfs_dot_generic) takes for .gitattributes, in lower case: the name itself,
// its short names `gitatt~1` to `~4`, and the eight characters of the short name NTFS falls back to — a start of
// `gi7d29`, a tilde and a number — each followed by any periods and spaces, and by anything after a colon
const NTFS_NAMES = new RegExp('^(?:[.]gitattributes|gitatt~[1-4]|gi7d29~[1-9]|gi7d2~[1-9][0-9]|gi7d~[1-9][0-9]{2}'
  + '|gi7~[1-9][0-9]{3}|gi~[1-9][0-9]{4}|g~[1-9][0-9]{5}|~[1-9][0-9]{6})[ .]*(?::.*)?$', 's');
// a part of a name as the scan compares it: what `IGNORABLE` matches left out, then upper-cased and lower-cased
const compared = (part: string) => [...part].filter((c) => !IGNORABLE.test(c)).join('').toUpperCase().toLowerCase();
const attributesFile = (path: string) => {
  const name = path.split('/').pop() ?? '';
  return [name, name.split('\\').pop() ?? ''].some((part) => NTFS_NAMES.test(compared(part)))
    || compared(name.split('\\')[0]) === '.gitattributes';
};
function attributesNaming(files: readonly Tracked[], local: readonly Tracked[]): string[] {
  const named = new Set([...files, ...local].filter((f) => attributesFile(f.path) && Buffer.from(f.bytes).includes(ATTRIBUTE))
    .map((f) => f.path));
  return files.map((f) => f.path).filter((path) => named.has(path));
}

/**
 * The tracked attributes files that are links, as the index holds them or, where the index's entry is not one, as the
 * checkout does — whatever they point to, as `git fsck` warns of a .gitattributes that is one from 2.32.0 on (its
 * fsck.c; 2.39.5 and 2.54.0 warned, 2.30.2 and 2.25.1 said nothing). git before 2.32 read an attributes file in the
 * checkout through a link: its attr.c opens one with `fopen_or_warn` in 2.30.9 and 2.31.8, the last of their lines, and
 * the ones in the tree with `open_nofollow` from 2.32.0 on. Under a .gitattributes that links to a file giving x.md a
 * `working-tree-encoding`, `git checkout -- x.md` wrote x.md through that encoding on Debian 11's git 2.30.2 and Ubuntu
 * 20.04's 2.25.1, where the index's read named nothing, and git 2.39.5 and 2.54.0 refused the link — and the reviewer's
 * pull did so on git 2.30.1 under a `.GITATTRIBUTES` that is one, where the file system does not tell case apart
 * (round-26 review of #181).
 */
function attributesLinks(root: string, links: readonly string[], paths: readonly string[]): [string[], string[]] {
  const index = links.filter(attributesFile);
  const checkout = paths.filter((path) => !index.includes(path) && attributesFile(path) && atPath(root, path)?.isSymbolicLink());
  return [index, checkout];
}

/**
 * A repository's scan: the paths it read, what hides in them and in their files — each file read as its index and its
 * checkout hold it — and what it could not read: a path that is not UTF-8, an index object or a checkout file decoded
 * short of its length (one that is not UTF-8 text), a tracked path still in the checkout that is neither a regular file
 * nor a link there (a folder), and what a reader may get in place of what it read — the file behind an index object
 * that is a Git LFS pointer git-lfs takes, or behind a checkout file that is one where its index object is not, and
 * another platform's checkout of a path whose `working-tree-encoding` has git write it through iconv
 * (rounds 22 and 23), "set" and "unset" spelled out aside (round 24) — and, erring toward reporting, whatever else
 * begins as a pointer does to `pointer` (rounds 16 to 22, as the header says) and an attributes file that names that
 * attribute at all, whatever another git or file system makes of it (rounds 24 and 25), or that is a link, in the index
 * or, where its entry there is not one, in the checkout (round 26). The checkout's pointer counts: git turns an index
 * object into the bytes it hands git-lfs on checkout, through `working-tree-encoding` say, so an index object that is
 * plain text can reach git-lfs as a pointer (round-19 review of #181, measured again). The real repository gets this
 * scan, and scratch ones get it too, so that each part of it is seen to matter (round-5 review, and Grok's
 * falsification of it: checks that only ever see a clean repository passed when they were dropped).
 */
function scanned(root: string): { paths: string[]; found: string[]; unread: string[] } {
  const { files, unnamed, links } = committed(root);
  const paths = files.map((f) => f.path);
  const local = checkedOut(root, paths);
  const staged = foundIn(files);
  const unstaged = foundIn(local, ' (checkout)');
  const other = (path: string) => {
    const at = atPath(root, path);
    return at !== undefined && !at.isFile() && !at.isSymbolicLink();
  };
  const pointers = new Set(files.filter((f) => pointer(f.bytes)).map((f) => f.path));
  const POINTER = "begins as a Git LFS pointer: a pointer's file is not in the repository";
  const ENCODED = "working-tree-encoding: another platform's iconv may write its checkout otherwise";
  const NAMING = 'names working-tree-encoding: gits and file systems make different things of it';
  const LINKED = 'a link: a git before 2.32 reads attributes from what it points to';
  const [indexLinks, checkoutLinks] = attributesLinks(root, links, paths);
  const unread = [
    ...unnamed.map((path) => `${path} (path: not UTF-8, so no file in the checkout is found by it)`),
    ...staged.read.filter(([, decoded], i) => decoded !== files[i].bytes.length).map(([path]) => path),
    ...[...pointers].map((path) => `${path} (${POINTER})`),
    ...local.filter((f) => !pointers.has(f.path) && pointer(f.bytes)).map((f) => `${f.path} (checkout: ${POINTER})`),
    ...unstaged.read.filter(([, decoded], i) => decoded !== local[i].bytes.length).map(([path]) => `${path} (checkout)`),
    ...paths.filter(other).map((path) => `${path} (checkout: not a regular file)`),
    ...encodingNamed(root, paths).map((path) => `${path} (${ENCODED})`),
    ...attributesNaming(files, local).map((path) => `${path} (${NAMING})`),
    ...indexLinks.map((path) => `${path} (${LINKED})`),
    ...checkoutLinks.map((path) => `${path} (checkout: ${LINKED})`),
  ];
  return { paths, found: [...staged.found, ...unstaged.found], unread };
}

describe('bidirectional controls, tag characters, and two variation selectors in a row', () => {
  it('are looked for in a repository of real size, so the scan is not vacuous', () => {
    expect(tracked.length).toBeGreaterThan(200);
  });

  // The tests that run git get 30 s, as probe-metered-output.test.ts's spawning rows do: on a loaded machine one took
  // 11.5 s, past vitest's 5 s (round-6 review).
  it('are in no tracked path and no tracked file, each read whole as the index and the checkout hold it', () => {
    expect(scanned(repoRoot)).toEqual({ paths: tracked, found: [], unread: [] });
  }, 30_000);
});

describe('the scan itself', () => {
  const ch = (...cps: number[]) => String.fromCodePoint(...cps);
  const file = (path: string, text: string): Tracked => ({ path, bytes: Buffer.from(text, 'utf8') });
  // Made in beforeAll, as probe-metered-output.test.ts makes its own, so a run that skips these leaves no folder.
  let scratch = '';
  beforeAll(() => { scratch = mkdtempSync(join(tmpdir(), 'hiding-characters-')); });
  afterAll(() => { if (scratch) rmSync(scratch, { recursive: true, force: true }); });
  /** A new repository in the scratch folder, and a way to run git in it. */
  const repoIn = (name: string) => {
    const repo = join(scratch, name);
    mkdirSync(repo);
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid',
      '-c', 'commit.gpgsign=false', ...args], { cwd: repo, stdio: 'pipe' });
    git('init', '-q');
    return { repo, git };
  };
  /**
   * A link, for the rows that need one: skipped where none can be made — win32 without the privilege, where symlinkSync
   * throws EPERM — and an error anywhere else (round-28 review of #181: the rows skipped on any error, on any platform,
   * so a row whose setup broke passed as skipped). The link call and the platform can be handed in, so that a row holds
   * that rule where every link is made (round-29 review: with none, the rows passed with the rule widened back), and
   * that row once hands in no platform, as the link rows do (round-30 review: with one always handed in, the rows
   * passed with the platform it falls back to fixed as win32).
   */
  const linkOrSkip = (target: string, path: string, skip: () => void, link: typeof symlinkSync = symlinkSync,
    platform: NodeJS.Platform = process.platform) => {
    try {
      link(target, path);
    } catch (err) {
      if (platform !== 'win32' || (err as NodeJS.ErrnoException).code !== 'EPERM') throw err;
      skip();
    }
  };

  // Each end of each range, so that a range cut short at either end fails.
  it.each([0x202a, 0x202e, 0x2066, 0x2069, 0x200e, 0x200f, 0x061c, 0xe0000, 0xe007f].map((cp) => [name(cp), cp]))(
    'finds %s', (_name, cp) => {
      expect(hiding(`a${ch(cp)}b`)).toEqual([`1:2 ${name(cp)}`]);
    },
  );

  it.each([
    [0x180b, 0x180b], [0x180d, 0x180d], [0x180f, 0x180f], [0xfe00, 0xfe00], [0xfe0f, 0xfe0f], [0xe0100, 0xe0100],
    [0xe01ef, 0xe01ef], [0xfe0f, 0xe0100],
  ].map(([a, b]) => [`${name(a)} ${name(b)}`, a, b]))('finds the second of two variation selectors in a row, %s', (_name, a, b) => {
    expect(hiding(`a${ch(a, b)}`)).toEqual([`1:3 ${name(b)}`]);
  });

  it('passes one variation selector after a character, and Korean text', () => {
    expect(hiding(`${ch(0x26a0, 0xfe0f)} ${ch(0xd55c, 0xae00)}`)).toEqual([]);
  });

  it('reports the line and the column of what it finds', () => {
    expect(hiding(`ab${ch(10)}c${ch(0x202e)}d`)).toEqual(['2:2 U+202E']);
  });

  it('fails a file that is not UTF-8 text, and reads one that is', () => {
    expect(scan(Buffer.from(`a${ch(0x202e)}`, 'utf16le'))).toEqual({ decoded: 0, found: ['not UTF-8 text: a NUL byte'] });
    expect(scan(Uint8Array.from([0x61, 0xff]))).toEqual({ decoded: 0, found: ['not UTF-8 text: an invalid byte sequence'] });
    expect(scan(Buffer.from(`a${ch(0x202e)}`, 'utf8'))).toEqual({ decoded: 4, found: ['1:2 U+202E'] });
    expect(scan(Buffer.from(`a${ch(0xd55c)}`, 'utf8'))).toEqual({ decoded: 4, found: [] });
  });

  // A skill under a dot folder, a source file, a file as big as the bundles, and an odd path — each a kind of file a
  // narrowed scan could skip (round-3 review of #181).
  it('reads every file it is given whole, whatever its kind or size, and every path', () => {
    const files = [
      file('.claude/skills/x/SKILL.md', `Run it ${ch(0x202e)}now`),
      file('src/x.ts', `const a = 1; ${ch(0x2066)}`),
      file('dist/big.js', `${'x'.repeat(3_000_000)}${ch(0xe0041)}`),
      file(`notes/a${ch(0x202e)}dm.txt`, 'fine'),
      file('docs/plain.md', 'fine'),
    ];
    const { read, found } = foundIn(files);
    expect(read).toEqual(files.map((f) => [f.path, f.bytes.length]));
    expect(found).toEqual([
      '.claude/skills/x/SKILL.md: 1:8 U+202E', 'src/x.ts: 1:14 U+2066', 'dist/big.js: 1:3000001 U+E0041',
      `notes/a${ch(0x202e)}dm.txt (path): 1:8 U+202E`,
    ]);
  });

  it('reads what the index holds, and what the checkout holds besides', () => {
    const { repo, git } = repoIn('repo');
    writeFileSync(join(repo, 'a.md'), `one ${ch(0x202e)}two`);
    writeFileSync(join(repo, 'b.md'), 'plain');
    writeFileSync(join(repo, 'e.md'), 'gone');
    writeFileSync(join(repo, 's.md'), 'left out');
    git('add', '-A');
    git('commit', '-q', '--no-verify', '-m', 'x');
    writeFileSync(join(repo, 'a.md'), 'rewritten on checkout'); // as ident, a filter or an encoding could
    writeFileSync(join(repo, 'b.md'), `plain ${ch(0x2067)}`); // an edit not yet staged
    rmSync(join(repo, 'e.md')); // a removal not yet staged (round-5 review)
    // a file a sparse checkout leaves out, which git's list of removed files does not name (Grok's falsification of
    // round 5)
    git('update-index', '--skip-worktree', 's.md');
    rmSync(join(repo, 's.md'));
    // a replace ref that would hand cat-file a clean object for a.md's (round-4 review)
    const blob = (text: string) => execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, input: text, encoding: 'utf8' }).trim();
    git('replace', blob(`one ${ch(0x202e)}two`), blob('clean'));
    // a path with a tab in it, which no Windows file name can hold, put straight into the index (Git for Windows
    // refuses it unless core.protectNTFS is off)
    const oid = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, input: `x${ch(0x2066)}`, encoding: 'utf8' }).trim();
    git('-c', 'core.protectNTFS=false', 'update-index', '--add', '--cacheinfo', `100644,${oid},c${TAB}d.md`);
    const { paths, found, unread } = scanned(repo);
    expect(paths).toEqual(['a.md', 'b.md', `c${TAB}d.md`, 'e.md', 's.md']);
    expect(found).toEqual(['a.md: 1:5 U+202E', `c${TAB}d.md: 1:2 U+2066`, 'b.md (checkout): 1:7 U+2067']);
    // the tab path, the removed file and the one left out have no file in the checkout: nothing there to read
    expect(unread).toEqual([]);
    expect(checkedOut(repo, paths).map((f) => f.path)).toEqual(['a.md', 'b.md']);
  }, 30_000);

  // The kinds of file a narrowed checkout read could skip — under a dot folder, as big as the bundles, a source file —
  // each edited and not yet staged (round-6 review: nothing showed which files the checkout half reads).
  it('reads every kind of checkout file, whole', () => {
    const { repo, git } = repoIn('kinds');
    const kinds = ['.claude/skills/x/SKILL.md', 'dist/big.js', 'src/x.ts'];
    for (const path of kinds) {
      mkdirSync(join(repo, dirname(path)), { recursive: true });
      writeFileSync(join(repo, path), 'clean');
    }
    git('add', '-A');
    git('commit', '-q', '--no-verify', '-m', 'x');
    writeFileSync(join(repo, '.claude/skills/x/SKILL.md'), `Run it ${ch(0x202e)}now`);
    writeFileSync(join(repo, 'dist/big.js'), `${'x'.repeat(3_000_000)}${ch(0xe0041)}`);
    writeFileSync(join(repo, 'src/x.ts'), `const a = 1; ${ch(0x2066)}`);
    expect(scanned(repo)).toEqual({
      paths: kinds,
      found: [
        '.claude/skills/x/SKILL.md (checkout): 1:8 U+202E', 'dist/big.js (checkout): 1:3000001 U+E0041',
        'src/x.ts (checkout): 1:14 U+2066',
      ],
      unread: [],
    });
  }, 30_000);

  it('reports a tracked file the checkout holds as a folder, rather than leave it unread (round-5 review)', () => {
    const { repo, git } = repoIn('replaced');
    writeFileSync(join(repo, 'f.md'), 'plain');
    git('add', '-A');
    git('commit', '-q', '--no-verify', '-m', 'x');
    rmSync(join(repo, 'f.md'));
    mkdirSync(join(repo, 'f.md'));
    expect(scanned(repo)).toEqual({ paths: ['f.md'], found: [], unread: ['f.md (checkout: not a regular file)'] });
  }, 30_000);

  // A path whose bytes are not UTF-8, put straight into the index, as a Linux contributor's could be (round-6 review:
  // read with U+FFFD in it, it matched no file in the checkout and was not reported).
  it('reports a path that is not UTF-8', () => {
    const { repo, git } = repoIn('unnamed');
    const oid = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, input: 'plain', encoding: 'utf8' }).trim();
    execFileSync('git', ['-c', 'core.protectNTFS=false', 'update-index', '-z', '--index-info'], {
      cwd: repo, input: Buffer.concat([Buffer.from(`100644 ${oid} 0${TAB}a`, 'utf8'), Uint8Array.from([0xff]), Buffer.from(`.md${NUL}`, 'utf8')]),
    });
    expect(scanned(repo)).toEqual({
      paths: [`a${ch(0xfffd)}.md`], found: [],
      unread: [`a${ch(0xfffd)}.md (path: not UTF-8, so no file in the checkout is found by it)`],
    });
  }, 30_000);

  it('takes only the lstat errors that mean nothing is there for nothing there (round-6 review)', () => {
    const failing = (code: string) => () => { throw Object.assign(new Error(code), { code }); };
    for (const code of ['ENOENT', 'ENOTDIR', 'ENAMETOOLONG']) expect(atPath('root', 'path', failing(code))).toBeUndefined();
    expect(() => atPath('root', 'path', failing('EACCES'))).toThrow('EACCES');
  });

  it('skips a row for want of a link only on win32, and only on EPERM (round-29 review)', () => {
    const failing = (code: string) => () => { throw Object.assign(new Error(code), { code }); };
    const skipped: string[] = [];
    linkOrSkip('t', 'made', () => skipped.push('made'), () => undefined, 'win32');
    linkOrSkip('t', 'refused', () => skipped.push('refused'), failing('EPERM'), 'win32');
    expect(() => linkOrSkip('t', 'elsewhere', () => skipped.push('elsewhere'), failing('EPERM'), 'linux')).toThrow('EPERM');
    expect(() => linkOrSkip('t', 'there', () => skipped.push('there'), failing('EEXIST'), 'win32')).toThrow('EEXIST');
    // with no platform handed in, as the link rows call it
    const unnamed = () => linkOrSkip('t', 'here', () => skipped.push('here'), failing('EPERM'));
    if (process.platform === 'win32') unnamed();
    else expect(unnamed).toThrow('EPERM');
    expect(skipped).toEqual(process.platform === 'win32' ? ['refused', 'here'] : ['refused']);
  });

  it('reports a file it could not decode whole, in the index or only in the checkout (Grok, round 5)', () => {
    const { repo, git } = repoIn('undecoded');
    writeFileSync(join(repo, 'x.bin'), Uint8Array.from([0x61, 0x00, 0x62]));
    writeFileSync(join(repo, 'y.md'), 'plain');
    git('add', '-A');
    git('commit', '-q', '--no-verify', '-m', 'x');
    writeFileSync(join(repo, 'y.md'), Uint8Array.from([0x61, 0xff])); // not UTF-8, and not yet staged
    expect(scanned(repo)).toEqual({
      paths: ['x.bin', 'y.md'],
      found: [
        'x.bin: not UTF-8 text: a NUL byte', 'x.bin (checkout): not UTF-8 text: a NUL byte',
        'y.md (checkout): not UTF-8 text: an invalid byte sequence',
      ],
      unread: ['x.bin', 'x.bin (checkout)', 'y.md (checkout)'],
    });
  }, 30_000);

  // The rows on `working-tree-encoding` below, with what the scan says of a path whose value git hands iconv, which
  // another platform may read otherwise, and of an attributes file that names the attribute at all or is a link
  // (`encodingNamed`, `attributesNaming` and `attributesLinks` say what was measured). An object `git add` refuses is
  // put in by hand, as the hiding one was: one under a name this platform's iconv does not read, under the attribute
  // set with no value, or under UTF-16 with no byte-order mark.
  const ENCODED = "working-tree-encoding: another platform's iconv may write its checkout otherwise";
  const NAMING = 'names working-tree-encoding: gits and file systems make different things of it';
  const LINKED = 'a link: a git before 2.32 reads attributes from what it points to';
  // a 20-byte text with two tag characters, read as UTF-16LE and stored as UTF-8: plain text, with none in it
  const tagged = Buffer.from(Buffer.from(`plain ${ch(0xe0041, 0xe0042)} here${NL}`, 'utf8').toString('utf16le'), 'utf8');
  const putObject = (repo: string, git: (...args: string[]) => unknown, path: string, bytes: Buffer) => {
    const oid = execFileSync('git', ['hash-object', '-w', '--no-filters', '--stdin'], { cwd: repo, input: bytes, encoding: 'utf8' });
    git('update-index', '--add', '--cacheinfo', `100644,${oid.trim()},${path}`);
  };

  // git's own `working-tree-encoding` writes a file to the checkout in another encoding: the index holds UTF-8, and
  // where the checkout's bytes are not UTF-8 text — UTF-16's NUL bytes here — the file fails (round-17 review of #181;
  // bytes that are UTF-8 text in either, ASCII under ISO-8859-1 say, passed that check — round 18 — and since round 22
  // fail on their attribute alone)
  it('reports a file git writes to the checkout in another encoding, as the checkout holds it', () => {
    const { repo, git } = repoIn('encoding');
    writeFileSync(join(repo, '.gitattributes'), `w.txt working-tree-encoding=UTF-16LE-BOM${NL}`);
    writeFileSync(join(repo, 'w.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`plain text${NL}`, 'utf16le')]));
    git('add', '-A');
    git('commit', '-q', '--no-verify', '-m', 'x');
    rmSync(join(repo, 'w.txt'));
    git('checkout', '--', 'w.txt'); // so that git, not this test, writes the checkout's bytes
    expect(readFileSync(join(repo, 'w.txt')).subarray(0, 4)).toEqual(Buffer.from([0xff, 0xfe, 0x70, 0x00]));
    expect(execFileSync('git', ['cat-file', '-p', ':w.txt'], { cwd: repo, encoding: 'utf8' })).toBe(`plain text${NL}`);
    expect(scanned(repo)).toEqual({
      paths: ['.gitattributes', 'w.txt'], found: ['w.txt (checkout): not UTF-8 text: a NUL byte'],
      unread: ['w.txt (checkout)', `w.txt (${ENCODED})`, `.gitattributes (${NAMING})`],
    });
  }, 30_000);

  // and one whose encoding this platform does not read, which git writes to the checkout as it is: a name no iconv
  // reads stands in for one only some do, so that the row runs alike on every platform; u.md's value is the word
  // "unspecified", b.md's and c.md's are names that only begin or end as UTF-8's, m.md's and n.md's are other spellings
  // of UTF-8 that git hands iconv (`UTF_8` and `utf--8`, which of the three only musl's reads), g.md's is UTF-16, and
  // g.md, gone.md, m.md and n.md have no file in the checkout. e.md, f.md, s.md, y.md and z.md give values git writes
  // no checkout through iconv under — an empty one, `UTF-8`, the attribute set with no value (which `git add` refuses,
  // so s.md has no file in the checkout either), unset, and `utf8` — and are not reported, nor is y.md for another
  // attribute it has (rounds 23 to 25).
  it('reports a path whose working-tree-encoding git hands iconv, though this platform writes its checkout as the index holds it', () => {
    const { repo, git } = repoIn('encoding-name');
    writeFileSync(join(repo, '.gitattributes'), [
      'x.md working-tree-encoding=NOT-AN-ENCODING', 'u.md working-tree-encoding=unspecified',
      'b.md working-tree-encoding=UTF-8-BOM', 'c.md working-tree-encoding=X-UTF8', 'g.md working-tree-encoding=UTF-16',
      'm.md working-tree-encoding=UTF_8', 'n.md working-tree-encoding=utf--8',
      'gone.md working-tree-encoding=NOT-AN-ENCODING', 'e.md working-tree-encoding=', 'f.md working-tree-encoding=UTF-8',
      's.md working-tree-encoding', 'y.md -working-tree-encoding diff=x', 'z.md working-tree-encoding=utf8',
    ].map((line) => line + NL).join(''));
    for (const path of ['e.md', 'f.md', 'y.md', 'z.md']) writeFileSync(join(repo, path), `plain${NL}`);
    git('add', '.gitattributes', 'e.md', 'f.md', 'y.md', 'z.md');
    for (const path of ['x.md', 'u.md', 'b.md', 'c.md', 'g.md', 'gone.md', 'm.md', 'n.md', 's.md']) putObject(repo, git, path, tagged);
    git('commit', '-q', '--no-verify', '-m', 'x');
    git('checkout', '--', 'x.md', 'u.md', 'b.md', 'c.md'); // git cannot write them in those encodings, says so, and writes them as they are
    expect(readFileSync(join(repo, 'x.md'))).toEqual(tagged);
    expect(scanned(repo)).toEqual({
      paths: ['.gitattributes', 'b.md', 'c.md', 'e.md', 'f.md', 'g.md', 'gone.md', 'm.md', 'n.md', 's.md', 'u.md', 'x.md', 'y.md', 'z.md'],
      found: [],
      unread: [...['b.md', 'c.md', 'g.md', 'gone.md', 'm.md', 'n.md', 'u.md', 'x.md'].map((path) => `${path} (${ENCODED})`),
        `.gitattributes (${NAMING})`],
    });
  }, 30_000);

  // The attributes count as the index holds them and as the checkout does: an edit to .gitattributes not yet staged
  // names y.md where the committed one names x.md (round-23 review of #181), and its patterns are matched whatever
  // their case and in it, as the index's are: w.md is named only by `W.MD`, and v.md only where a later `V.MD` that
  // turns the attribute off is not taken for its name (round 26)
  it('reads a working-tree-encoding from the index and from the checkout', () => {
    const { repo, git } = repoIn('encoding-sources');
    writeFileSync(join(repo, '.gitattributes'), `x.md working-tree-encoding=ISO-8859-1${NL}`);
    for (const path of ['v.md', 'w.md', 'x.md', 'y.md']) writeFileSync(join(repo, path), `plain${NL}`);
    git('add', '-A');
    git('commit', '-q', '--no-verify', '-m', 'x');
    writeFileSync(join(repo, '.gitattributes'), [ // not staged
      'y.md working-tree-encoding=ISO-8859-1', 'W.MD working-tree-encoding=ISO-8859-1',
      'v.md working-tree-encoding=ISO-8859-1', 'V.MD -working-tree-encoding',
    ].map((line) => line + NL).join(''));
    expect(scanned(repo)).toEqual({
      paths: ['.gitattributes', 'v.md', 'w.md', 'x.md', 'y.md'], found: [],
      unread: [...['v.md', 'w.md', 'x.md', 'y.md'].map((path) => `${path} (${ENCODED})`), `.gitattributes (${NAMING})`],
    });
  }, 30_000);

  // and a .gitattributes that names itself with UTF-7, which some platforms write to the checkout so that it names
  // nothing (`encodingNamed`): from the index it names both paths on every platform, x.md by the stand-in name above
  it('reports the paths a .gitattributes names when it names itself in another encoding', () => {
    const { repo, git } = repoIn('encoding-self');
    const attributes = `.gitattributes working-tree-encoding=UTF-7${NL}x.md working-tree-encoding=NOT-AN-ENCODING${NL}`;
    putObject(repo, git, '.gitattributes', Buffer.from(attributes));
    putObject(repo, git, 'x.md', tagged);
    git('commit', '-q', '--no-verify', '-m', 'x');
    git('checkout', '--', '.');
    expect(scanned(repo)).toEqual({
      paths: ['.gitattributes', 'x.md'], found: [],
      unread: [...['.gitattributes', 'x.md'].map((path) => `${path} (${ENCODED})`), `.gitattributes (${NAMING})`],
    });
  }, 30_000);

  // An attributes file that names the attribute is reported whatever this git makes of it (`attributesNaming` says what
  // was measured): one with a line of more than 2048 bytes, one named in another case, one in another as Unicode folds
  // it, one that names it only past its first 110,000 bytes (with every file under 2.2 KB, a search of the first 4096
  // bytes alone passed), one that names it only in a comment, one only in an edit not yet staged and one only in the
  // index. None names a tracked path, so that the row holds on a git that applies the long line too (rounds 24 to 26).
  it('reports an attributes file that names working-tree-encoding, whatever this git makes of it', () => {
    const { repo, git } = repoIn('encoding-files');
    const names = (path: string) => `${path} working-tree-encoding=ISO-8859-1${NL}`;
    writeFileSync(join(repo, '.gitattributes'), `nothing.md${' '.repeat(2060)}${names('')}`); // a line of more than 2048 bytes
    for (const folder of ['docs', 'fold', 'late', 'note', 'old', 'sub']) mkdirSync(join(repo, folder));
    writeFileSync(join(repo, 'sub', '.GitAttributes'), names('nothing.md'));
    writeFileSync(join(repo, 'fold', `.gitattribute${ch(0x17f)}`), names('nothing.md'));
    writeFileSync(join(repo, 'late', '.gitattributes'), `${`*.txt text${NL}`.repeat(10_000)}${names('nothing.md')}`);
    writeFileSync(join(repo, 'note', '.gitattributes'), `# working-tree-encoding is given nowhere here${NL}`);
    writeFileSync(join(repo, 'docs', '.gitattributes'), `# plain${NL}`);
    writeFileSync(join(repo, 'old', '.gitattributes'), names('nothing.md'));
    writeFileSync(join(repo, 'x.md'), `plain${NL}`);
    git('add', '-A');
    git('commit', '-q', '--no-verify', '-m', 'x');
    writeFileSync(join(repo, 'docs', '.gitattributes'), names('nothing.md')); // not staged
    writeFileSync(join(repo, 'old', '.gitattributes'), `# plain${NL}`); // not staged
    const files = ['.gitattributes', 'docs/.gitattributes', `fold/.gitattribute${ch(0x17f)}`, 'late/.gitattributes', 'note/.gitattributes',
      'old/.gitattributes', 'sub/.GitAttributes'];
    expect(scanned(repo)).toEqual({ paths: [...files, 'x.md'], found: [], unread: files.map((path) => `${path} (${NAMING})`) });
  }, 30_000);

  // The index's attributes are read with patterns matched whatever their case and in it, and past a replace ref, as the
  // objects are (`encodingNamed` says what was measured): x.md is named only by `X.MD`, and v.md only where a later
  // `V.MD` that turns the attribute off is not taken for its name (rounds 24 and 25)
  it('reads a working-tree-encoding whatever the case of its pattern, and past a replace ref', () => {
    const { repo, git } = repoIn('encoding-case');
    writeFileSync(join(repo, '.gitattributes'), [
      'X.MD working-tree-encoding=NOT-AN-ENCODING', 'y.md working-tree-encoding=ISO-8859-1',
      'v.md working-tree-encoding=NOT-AN-ENCODING', 'V.MD -working-tree-encoding',
    ].map((line) => line + NL).join(''));
    writeFileSync(join(repo, 'y.md'), `plain${NL}`);
    git('add', '.gitattributes', 'y.md');
    for (const path of ['v.md', 'x.md']) putObject(repo, git, path, tagged);
    git('commit', '-q', '--no-verify', '-m', 'x');
    git('checkout', '--', 'v.md', 'x.md');
    const empty = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, input: NL, encoding: 'utf8' }).trim();
    git('replace', String(git('rev-parse', ':.gitattributes')).trim(), empty); // the committed .gitattributes, replaced
    writeFileSync(join(repo, '.gitattributes'), NL); // not staged: from here only the index names v.md, x.md and y.md
    expect(scanned(repo)).toEqual({
      paths: ['.gitattributes', 'v.md', 'x.md', 'y.md'], found: [],
      unread: [...['v.md', 'x.md', 'y.md'].map((path) => `${path} (${ENCODED})`), `.gitattributes (${NAMING})`],
    });
  }, 30_000);

  // An attributes file whose name git's own name check takes for .gitattributes, holding one of the sixteen code points
  // it leaves out of a name because HFS+ does, is reported too (`attributesNaming`; round 25) — each of the sixteen
  // (round-26 review of #181: built from the ends of each run, the row passed with only those ends taken), seven of
  // them bidirectional controls, which the scan finds in the path besides, as the index and the checkout hold it, and
  // two of them next to each other, which `git fsck` took for one as well (round-32 review: with one in each name, the
  // row passed with only the first left out, or the second of two in a row kept) — beside names holding the code point
  // past each end of a run where it is not default-ignorable, which are not reported (round-31 review: with none here,
  // a scan leaving those out too passed; U+200B and U+00AD, which round 30 put here, are default-ignorable, and the row
  // below holds them)
  it('reports an attributes file whose name git takes for .gitattributes, as HFS+ would', () => {
    const { repo, git } = repoIn('encoding-hfs');
    const spelled = (cp: number) => `h${cp.toString(16)}/.git${ch(cp)}attributes`;
    const taken = [0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x206a, 0x206b, 0x206c, 0x206d,
      0x206e, 0x206f, 0xfeff].map(spelled);
    const two = `h200c-200d/.git${ch(0x200c, 0x200d)}attributes`; // two of them next to each other
    const past = [0x2010, 0x2029, 0x202f, 0x2070, 0xfefe, 0xff00];
    const files = [two, ...taken, ...past.map((cp) => `n${spelled(cp)}`)]; // in git's order, after the sixteen
    for (const path of files) {
      mkdirSync(join(repo, path.split('/')[0]));
      writeFileSync(join(repo, path), `nothing.md working-tree-encoding=ISO-8859-1${NL}`);
    }
    git('add', '-A');
    git('commit', '-q', '--no-verify', '-m', 'x');
    const found = (where: string) => [0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e]
      .map((cp) => `${spelled(cp)}${where} (path): 1:11 ${name(cp)}`);
    expect(scanned(repo)).toEqual({
      paths: files, found: [...found(''), ...found(' (checkout)')],
      unread: [two, ...taken].map((path) => `${path} (${NAMING})`),
    });
  }, 30_000);

  // and one whose name Linux's case folding takes for .gitattributes, in a folder that has it: one holding a
  // default-ignorable code point besides the sixteen, a format character, a combining mark, a filler letter or one
  // unassigned (`attributesNaming`; round-31 review of #181: with the sixteen alone left out, a clone into such a
  // folder read a `.git` + U+200B + `attributes` as .gitattributes, which the scan passed), and two of them in one
  // name, apart and next to each other, which e2fsprogs's copy of its tables folded out as well (round-32 review: with
  // one in each name, the row passed with only the first left out, or the second of two in a row kept) — beside names
  // holding a code point that is not default-ignorable, a format character too, which the folding took for no
  // .gitattributes (e2fsprogs's copy of its tables) and which are not reported
  it('reports an attributes file whose name Linux\'s case folding takes for .gitattributes', () => {
    const { repo, git } = repoIn('encoding-casefold');
    const spelled = (cp: number) => `c${cp.toString(16).padStart(5, '0')}/.git${ch(cp)}attributes`;
    const taken = [0xad, 0x34f, 0x115f, 0x17b4, 0x180e, 0x200b, 0x2060, 0x2064, 0x3164, 0xfe0f, 0xffa0, 0xfff0, 0x1bca0,
      0x1d173, 0xe0100, 0xe0fff].map(spelled);
    const two = [`c-apart/.gi${ch(0xad)}t${ch(0x200b)}attributes`, `c-next/.git${ch(0x200b, 0xad)}attributes`];
    const other = [0xa0, 0x600, 0x2028, 0xfff9, 0xe1000];
    const files = [...two, ...taken, ...other.map((cp) => `n${spelled(cp)}`)]; // in git's order
    for (const path of files) {
      mkdirSync(join(repo, path.split('/')[0]));
      writeFileSync(join(repo, path), `nothing.md working-tree-encoding=ISO-8859-1${NL}`);
    }
    git('add', '-A');
    git('commit', '-q', '--no-verify', '-m', 'x');
    expect(scanned(repo)).toEqual({
      paths: files, found: [], unread: [...two, ...taken].map((path) => `${path} (${NAMING})`),
    });
  }, 30_000);

  // and one whose name git's NTFS name check takes for .gitattributes (`attributesNaming`; round 26): followed by
  // periods and spaces, or by a colon and a stream's name, or by a colon alone or with a line break after it (round-29
  // review of #181: with neither, the row passed with "anything after a colon" narrowed), or by periods and spaces and
  // then a colon (round-31 review: with no name holding both, the row passed with a name taking one or the other), and
  // its 8.3 short names, the one NTFS falls back to at each length (round-27 review: with four of its seven lengths in
  // no row, the row passed with those left out of the check), its number beginning with 1 and with 9, and with 0 and 9
  // after its first digit (round 31: with each digit spelled one way, the row passed with the digits narrowed) — and
  // ones after a backslash, which Win32 takes for a folder's separator (round 27), one of them after two (round-28
  // review: with one, the row passed with the name read after the first) and one in capitals (round 31: with none, the
  // row passed with that part read as it is spelled; Git for Windows 2.45.1 cloned a `docs\.GITATTRIBUTES` to
  // docs/.GITATTRIBUTES, whose encoding the checkout's read then gave the x.md beside it), one whose colon comes before
  // a backslash, which that check reads whole, in lower case and in capitals (round 28: it had been read after the
  // backslash, as `y`; round-32 review: with it in lower case alone, the row passed with the whole name compared as it
  // is spelled), and `.gitattributes` before a backslash, in capitals and with one of the sixteen in it too, which Git
  // for Windows's HFS check takes (rounds 29 and 30), or with two of them next to each other, which it takes as well
  // (round-33 review: with none, the row passed with only the first left out of that part, or the second of two in a
  // row kept there), and before two backslashes (round 31: with one, the row passed with the part before the last
  // read), all put into the index by hand, as Git for Windows refuses to check out a name that ends in a period or a
  // space or holds a colon or a backslash; and, erring toward reporting, eight that neither git's `git fsck` took, as
  // the scan compares every part of a name alike: a short name with one of the sixteen in it, `.gitattributeſ.`, and
  // `.gitattributes` with one of the sixteen in it after a backslash (round 31: with none, the row passed with the
  // whole name and the part after a backslash, or that part alone, compared otherwise), the same name and
  // `.gitattributeſ` before a colon and a backslash, and `.gitattributeſ` before a backslash (round 32: with none, the
  // row passed with the whole name alone compared otherwise, or the part before a backslash lower-cased alone), and
  // `.gitattributes` with two of the sixteen next to each other in it before a colon and a backslash, and
  // `.gitattributeſ` with two of them in it after a backslash (round 33: with neither, the row passed with only the
  // first left out of the whole name or of the part after a backslash, or the second of two in a row kept there, or
  // that part lower-cased alone) — beside names git's checks do not take, which are not reported (round-30 review: with
  // only some of them here, the row passed with the check widened to take the others): an extension, on the name or on
  // a short name, and a short name before `~1` or past `~4`; the one NTFS falls back to at each length, a character
  // short, a character long, and with a 0 where its number begins; a name with a letter before its dot, a letter for it
  // or none, or a line break and no colon after it; `.gitattributes.` and `GITATT~1` before a backslash, which the NTFS
  // check takes only as a whole name (round 30: what came before a backslash had been matched as a whole name is); and
  // `.gitattributes` with a space before a backslash, and between two (round 31: with neither, the row passed with the
  // part before a backslash taken with spaces after it, or the part before the last)
  it('reports an attributes file whose name git takes for .gitattributes, as NTFS would', () => {
    const { repo, git } = repoIn('encoding-ntfs');
    const bs = ch(0x5c); // a backslash
    const taken = ['.gitattributes.', '.gitattributes ', '.GITATTRIBUTES. .', '.gitattributes::$DATA', '.gitattributes:x',
      '.gitattributes:', `.gitattributes:x${NL}y`, '.gitattributes. :x', 'GITATT~1', 'gitatt~4. ', 'GI7D29~1',
      'gi7d29~9', 'gi7d2~10', 'gi7d2~99', 'gi7d~123', 'gi7d~909', 'gi7~1234', 'gi7~9090', 'gi~12345', 'gi~90909',
      'g~123456', 'g~909090', '~1234567', '~9090909', `docs${bs}.gitattributes`, `docs${bs}.GITATTRIBUTES`,
      `a${bs}b${bs}.gitattributes`, `.gitattributes:x${bs}y`, `.GITATTRIBUTES:x${bs}y`, `.gitattributes${bs}x`,
      `.gitattributes${bs}x${bs}y`, `.GITATTRIBUTES${bs}x`, `.git${ch(0x200c)}attributes${bs}x`,
      `.git${ch(0x200c, 0x200d)}attributes${bs}x`];
    const erring = [`GITATT~1${ch(0x200c)}`, `.gitattribute${ch(0x17f)}.`, `docs${bs}.git${ch(0x200c)}attributes`,
      `.git${ch(0x200c)}attributes:x${bs}y`, `.gitattribute${ch(0x17f)}:x${bs}y`, `.gitattribute${ch(0x17f)}${bs}x`,
      `.git${ch(0x200c, 0x200d)}attributes:x${bs}y`, `docs${bs}.git${ch(0x200c, 0x200d)}attribute${ch(0x17f)}`];
    const files = [...taken, ...erring, '.gitattributes.txt', 'GITATT~1.TXT', 'GITATT~0', 'GITATT~5',
      'gi7d29~', 'gi7d29~10', 'gi7d29~0', 'gi7d2~1', 'gi7d2~100', 'gi7d2~01', 'gi7d~12', 'gi7d~1234', 'gi7d~012',
      'gi7~123', 'gi7~12345', 'gi7~0123', 'gi~1234', 'gi~123456', 'gi~01234', 'g~12345', 'g~1234567', 'g~012345',
      '~123456', '~12345678', '~0123456', 'x.gitattributes', 'xgitattributes', 'gitattributes', `.gitattributes${NL}y`,
      `.gitattributes.${bs}x`, `GITATT~1${bs}x`, `.gitattributes ${bs}x`, `x${bs}.gitattributes${bs}y`]
      .map((name, i) => `n${String(i).padStart(2, '0')}/${name}`);
    const oid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: repo, input: `nothing.md working-tree-encoding=ISO-8859-1${NL}`, encoding: 'utf8',
    }).trim();
    for (const path of files) git('-c', 'core.protectNTFS=false', 'update-index', '--add', '--cacheinfo', `100644,${oid},${path}`);
    git('commit', '-q', '--no-verify', '-m', 'x');
    expect(scanned(repo)).toEqual({
      paths: files, found: [],
      unread: files.slice(0, taken.length + erring.length).map((path) => `${path} (${NAMING})`),
    });
  }, 30_000);

  // An attributes file that is a link is reported whatever it points to (`attributesLinks` says what was measured):
  // here links put into the index by hand, so that the row runs where the checkout cannot hold a link — a
  // `.GITATTRIBUTES` with no file in the checkout, a docs/.gitattributes with the plain file holding the link's text
  // that such a checkout writes in its place, and a sub/.gitattributes that points out of the repository — beside a
  // link that is no attributes file, which is not reported (round 26, and Grok's falsification of it: no row held that
  // plain file; round-27 review of #181: every link pointed at a tracked file)
  it('reports an attributes file that is a link, as the index holds it', () => {
    const { repo, git } = repoIn('linked-attributes');
    mkdirSync(join(repo, 'docs'));
    writeFileSync(join(repo, 'docs', 'notes.txt'), `nothing.md working-tree-encoding=ISO-8859-1${NL}`);
    git('add', '-A');
    const link = (path: string, target: string) => {
      const oid = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, input: target, encoding: 'utf8' }).trim();
      git('update-index', '--add', '--cacheinfo', `120000,${oid},${path}`);
    };
    link('.GITATTRIBUTES', 'docs/notes.txt');
    link('docs/.gitattributes', 'notes.txt');
    link('notes.md', 'docs/notes.txt');
    link('sub/.gitattributes', '../../outside.txt');
    git('commit', '-q', '--no-verify', '-m', 'x');
    writeFileSync(join(repo, 'docs', '.gitattributes'), 'notes.txt'); // as a checkout that cannot write a link writes it
    expect(scanned(repo)).toEqual({
      paths: ['.GITATTRIBUTES', 'docs/.gitattributes', 'docs/notes.txt', 'notes.md', 'sub/.gitattributes'], found: [],
      unread: [`.GITATTRIBUTES (${LINKED})`, `docs/.gitattributes (${LINKED})`, `sub/.gitattributes (${LINKED})`],
    });
  }, 30_000);

  // and as the checkout holds it: a committed .gitattributes, reported once, as the index holds it, and links in place
  // of files the index holds, not yet staged, one to a tracked file and one out of the repository (round-28 review of
  // #181: with only the second, the row passed with a link to a tracked file left out of the check)
  it('reports an attributes file that is a link, as the checkout holds it', (ctx) => {
    const { repo, git } = repoIn('linked-attributes-checkout');
    git('config', 'core.symlinks', 'true');
    for (const folder of ['docs', 'sub']) mkdirSync(join(repo, folder));
    writeFileSync(join(repo, 'docs', 'notes.txt'), `nothing.md working-tree-encoding=ISO-8859-1${NL}`);
    for (const folder of ['docs', 'sub']) writeFileSync(join(repo, folder, '.gitattributes'), `# plain${NL}`);
    linkOrSkip('docs/notes.txt', join(repo, '.gitattributes'), () => ctx.skip());
    git('add', '-A');
    git('commit', '-q', '--no-verify', '-m', 'x');
    for (const folder of ['docs', 'sub']) rmSync(join(repo, folder, '.gitattributes'));
    symlinkSync('notes.txt', join(repo, 'docs', '.gitattributes')); // not staged
    symlinkSync('../../outside.txt', join(repo, 'sub', '.gitattributes')); // not staged
    expect(scanned(repo)).toEqual({
      paths: ['.gitattributes', 'docs/.gitattributes', 'docs/notes.txt', 'sub/.gitattributes'], found: [],
      unread: [`.gitattributes (${LINKED})`, `docs/.gitattributes (checkout: ${LINKED})`,
        `sub/.gitattributes (checkout: ${LINKED})`],
    });
  }, 30_000);

  // The Git LFS pointers both rows below build — the checkout-pointer row has git write them to the checkout, the LFS
  // row commits them to the index — the same texts (the checkout row ends one of odd length with a line break, as its
  // comment says), so that the checkout's pointers are looked for as the index's are (round-21 review of #181: with
  // three, the row passed with the checkout's check alone narrowed in seven other ways). They are the three kinds `LFS`
  // names; text that only begins like one, said to begin so (round 16); one behind each white space git-lfs 3.5.1 was
  // seen to skip — every one JavaScript's \s holds but the byte-order mark, and U+0085 — and one behind a CRLF, and one
  // behind 899 spaces, the most it takes in front of today's, whose 40-byte prefix then ends 939 bytes in (round 17 and
  // Grok's falsification of it); a git-media one behind 910, whose 30-byte prefix then ends 940 bytes in, the deepest
  // of the three kinds (round 18); one behind a byte-order mark, which git-lfs does not skip, reported too, as this
  // errs that way (Grok's falsification of round 17); one with 3,000,000 spaces after it, as git-lfs reads the first
  // 1024 bytes of an object of any size (rounds 22 and 23); and one behind each form of extension lines below. One
  // behind a zero-width space, which neither skips (Grok's falsification of round 17), and one with a line of spaces
  // between an extension line and the version line, which git-lfs refuses (round 18), are read as text. Read as
  // UTF-16LE, as the checkout row's index objects are, a byte `f` to `i`, or `*` to `.`, at an even offset with a space
  // after it is U+2066 to U+2069, or U+202A to U+202E, which the scan reports — so the note says "in a pointer", and
  // the eleven extension lines share one name (round 21).
  const kinds = ['https://git-lfs.github.com/spec/v1', 'https://hawser.github.com/spec/v1', 'http://git-media.io/v/2'];
  const pointerOf = (version: string) => `version ${version}${NL}oid sha256:${'0'.repeat(64)}${NL}size 9${NL}`;
  const plain = pointerOf(kinds[0]);
  const skipped = [9, 10, 11, 12, 13, 32, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
    0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000];
  const leads: [string, string][] = [['crlf', ch(13, 10)], ['spaces', ' '.repeat(899)], ['bom', ch(0xfeff)],
    ...skipped.map((cp): [string, string] => [`u${cp.toString(16).padStart(4, '0')}`, ch(cp)])];
  const extLine = (key: string) => `${key} sha256:${'1'.repeat(64)}${NL}`;
  const crlf = (text: string) => text.replaceAll(NL, ch(13, 10));
  // each form of extension lines git-lfs took (round 18), and the ones rounds 19 to 21 found no row held: an empty line
  // after the last one, in CRLF or after an LF line, two in a row, two CRLF lines with one between, a number other than
  // 0 or 1, a name not in lower case, white space in front of the first, and the most empty lines and the most lines
  // git-lfs takes — 830 after the shortest extension line, 80 bytes, in front of the shortest pointer, git-media's, and
  // eleven such lines (one key twice): one more of either puts part of the pointer's size or oid past the first 1024
  // bytes git-lfs reads (rounds 21 and 22, measured again)
  const extForms: [string, string][] = [
    ['one', extLine('ext-0-foo') + plain], ['two', extLine('ext-0-foo') + NL + extLine('ext-1-bar') + plain],
    ['crlf', crlf(extLine('ext-0-foo') + plain)], ['empty-after', extLine('ext-0-foo') + NL + plain],
    ['crlf-empty', crlf(extLine('ext-0-foo') + NL + plain)], ['lf-crlf-empty', extLine('ext-0-foo') + ch(13, 10) + plain],
    ['two-empty', extLine('ext-0-foo') + NL + NL + plain],
    ['crlf-two', crlf(extLine('ext-0-foo') + NL + extLine('ext-1-bar') + plain)],
    ['nine', extLine('ext-9-foo') + plain], ['name', extLine('ext-0-Foo_9') + plain],
    ['ws-ext', `   ${extLine('ext-0-foo')}${plain}`],
    ['many-empty', extLine('ext-0-a') + NL.repeat(830) + pointerOf(kinds[2])],
    ['eleven', Array.from({ length: 11 }, (_, i) => extLine(`ext-${i % 10}-a`)).join('') + plain],
  ];
  /** The files the scan reports as pointers, as [path, text]. */
  const pointerFiles: [string, string][] = [
    ['note.md', `version ${kinds[0]} is the first line in a pointer.${NL}This file is not one.${NL}`],
    ...kinds.map((version, i): [string, string] => [`p${i}.md`, pointerOf(version)]),
    ...leads.map(([name, lead]): [string, string] => [`w-${name}.md`, lead + plain]),
    ['w-media.md', ' '.repeat(910) + pointerOf(kinds[2])],
    ['big.md', plain + ' '.repeat(3_000_000)],
    ...extForms.map(([name, text]): [string, string] => [`x-${name}.md`, text]),
  ];
  /** The two it reads as text. */
  const textFiles: [string, string][] = [
    ['y-spaces.md', `${extLine('ext-0-foo')}   ${NL}${plain}`], ['z-zwsp.md', ch(0x200b) + plain],
  ];

  // An index object git turns into a pointer on checkout: under `working-tree-encoding=UTF-16LE`, a blob that is a
  // pointer's bytes read as UTF-16LE is plain text in the index and the pointer in the checkout, where git-lfs would
  // take it; it fails as the checkout holds it (round-19 review of #181 — it had passed, the check reading only the
  // index; no LFS filter here, so the row runs where git-lfs is not set up). Its files are the ones above, reported or
  // read as text as in the LFS row — the note and the pointer behind a byte-order mark among those reported, which
  // git-lfs refuses — each of odd length with a line break after it, as UTF-16LE needs an even one (git-lfs 3.5.1 took
  // or refused each so ended as it did bare — round 21), and each is reported for its attribute too (round 22), as the
  // .gitattributes giving it is for naming it (round 24). `UTF-16LE` is a spelling glibc, musl and Git for Windows all
  // read; `UTF16LE` fails `git add` on Windows alone, and `UCS2LE` everywhere but on musl (round 20, measured again).
  it('reports a checkout file that begins as a Git LFS pointer where its index object does not', () => {
    const { repo, git } = repoIn('checkout-pointer');
    const even = (text: string) => (Buffer.byteLength(text) % 2 ? text + NL : text);
    const files = [...pointerFiles, ...textFiles].map(([path, text]): [string, string] => [path, even(text)]);
    writeFileSync(join(repo, '.gitattributes'), `*.md working-tree-encoding=UTF-16LE${NL}`);
    for (const [path, text] of files) writeFileSync(join(repo, path), text);
    git('add', '-A');
    git('commit', '-q', '--no-verify', '-m', 'x');
    for (const [path] of files) rmSync(join(repo, path));
    git('checkout', '--', '.'); // so that git writes the checkout's bytes
    for (const [path, text] of files) {
      expect(readFileSync(join(repo, path), 'utf8')).toBe(text);
      expect(execFileSync('git', ['cat-file', '-p', `:${path}`], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 }))
        .toBe(Buffer.from(text, 'utf8').toString('utf16le'));
    }
    const paths = files.map(([path]) => path).sort();
    expect(scanned(repo)).toEqual({
      paths: ['.gitattributes', ...paths], found: [],
      unread: [
        ...pointerFiles.map(([path]) => path).sort()
          .map((path) => `${path} (checkout: begins as a Git LFS pointer: a pointer's file is not in the repository)`),
        ...paths.map((path) => `${path} (${ENCODED})`),
        `.gitattributes (${NAMING})`,
      ],
    });
  }, 30_000);

  // A committed link is read as git stores it, the path it points to, in the index and in the checkout alike, and never
  // through — so, unless it is an attributes file (`attributesLinks`), it fails on no platform (round-5 review:
  // reported as not a regular file, a link failed on Linux and passed on win32, whose checkout writes a link as a plain
  // file; round-6 review: a link re-pointed and not yet staged went unread on Linux).
  it('reads a committed link as the path it points to, not through it', (ctx) => {
    const { repo, git } = repoIn('linked');
    git('config', 'core.symlinks', 'true');
    writeFileSync(join(repo, 'target.md'), `x${ch(0x202e)}`);
    linkOrSkip('target.md', join(repo, 'link.md'), () => ctx.skip());
    git('add', '-A');
    git('commit', '-q', '--no-verify', '-m', 'x');
    expect(scanned(repo)).toEqual({
      paths: ['link.md', 'target.md'], found: ['target.md: 1:2 U+202E', 'target.md (checkout): 1:2 U+202E'], unread: [],
    });
    rmSync(join(repo, 'link.md'));
    symlinkSync(`x${ch(0x202e)}y`, join(repo, 'link.md')); // re-pointed, not yet staged
    expect(scanned(repo).found).toEqual(['target.md: 1:2 U+202E', 'link.md (checkout): 1:2 U+202E', 'target.md (checkout): 1:2 U+202E']);
  }, 30_000);

  // the files above committed as they are written, so that the index holds each pointer
  it('reports a Git LFS pointer, whose file is not in the repository — any of the three kinds git-lfs reads (round 5, 6)', () => {
    const { repo, git } = repoIn('lfs');
    for (const [path, text] of [...pointerFiles, ...textFiles]) writeFileSync(join(repo, path), text);
    git('-c', 'core.autocrlf=false', 'add', '-A'); // as written: autocrlf, on by default on Windows, would store each CRLF as an LF
    git('commit', '-q', '--no-verify', '-m', 'x');
    // an index object that is a pointer is reported whatever the checkout holds: the file written in its place, as a
    // plain clone with LFS writes it, or no file at all (round-20 review of #181); neither is staged
    writeFileSync(join(repo, 'p1.md'), `the file a pointer stands for${NL}`);
    rmSync(join(repo, 'p2.md'));
    expect(scanned(repo)).toEqual({
      paths: [...pointerFiles, ...textFiles].map(([path]) => path).sort(), found: [],
      unread: pointerFiles.map(([path]) => path).sort()
        .map((path) => `${path} (begins as a Git LFS pointer: a pointer's file is not in the repository)`),
    });
  }, 30_000);

  // git's own answer passes every check in objects(), so each is shown failing on an answer built to fail it (round-5
  // review, the rule masked() in probe-metered-output.test.ts follows)
  describe('objects', () => {
    const a: Entry = { oid: 'a1', path: 'a.md' };
    const b: Entry = { oid: 'b2', path: 'b.md' };
    const answer = (text: string) => Buffer.from(text, 'utf8');

    it('hands back each blob in git\'s answer, in order, an empty one too', () => {
      expect(objects([a, b], answer(`a1 blob 2${NL}hi${NL}b2 blob 0${NL}${NL}`)))
        .toEqual([{ path: 'a.md', bytes: Buffer.from('hi') }, { path: 'b.md', bytes: Buffer.from('') }]);
    });

    it.each([
      ['another object than the one asked for', [a], `b2 blob 2${NL}hi${NL}`, 'answered "b2 blob" for a.md'],
      ['an object git cannot find', [a], `a1 missing${NL}`, 'answered "a1 missing" for a.md'],
      ['an object that is not a blob', [a], `a1 commit 2${NL}hi${NL}`, 'answered "a1 commit" for a.md'],
      ['no answer for the last entry', [a, b], `a1 blob 2${NL}hi${NL}`, 'left b.md unanswered'],
      ['an object cut short', [a], `a1 blob 5${NL}hi`, 'cut a.md short'],
      ['an object longer than git says', [a], `a1 blob 1${NL}hi${NL}`, 'put no newline after a.md'],
      ['no newline after the last object', [a], `a1 blob 2${NL}hi`, 'put no newline after a.md'],
      ['more than was asked', [a], `a1 blob 2${NL}hi${NL}b2 blob 0${NL}${NL}`, 'answered more than was asked'],
    ] as [string, Entry[], string, string][])('throws on %s', (_what, entries, text, message) => {
      expect(() => objects(entries, answer(text))).toThrow(message);
    });
  });
});
