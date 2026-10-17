/**
 * Where the metered-billing probe makes a value it did not write itself — a response field, a status text, a
 * header, an error message, a response body — safe to print.
 *
 * WHY. SonarCloud jssecurity:S5145 flagged the probe's raw prints. Reproducing it on 2026-10-17 with fetch replaced
 * showed a response forging a verdict line, driving the terminal with raw escape sequences, and — through a field
 * that cannot become a string (an object whose toString is not a function) — crashing the probe after a billed
 * request into exit 1, which its header defines as "nothing was billed".
 *
 * HOW. Every character in Unicode's control (Cc), format (Cf), line-separator (Zl) and paragraph-separator (Zp)
 * categories — C0, DEL, C1, the bidi controls and the zero-width ones among them — is shown as a backslash-u escape,
 * except the line breaks two exports keep on purpose: printableJson keeps the LFs JSON.stringify(value, null, 1)
 * writes, and printableLines returns a text's own lines apart (dropping a CR that ends one). So no line an export
 * returns can hold a line break or drive a terminal that reads UTF-8. Other characters that show as nothing (the Hangul
 * fillers, variation selectors, combining marks) print as they are: they can do neither. A backslash prints as it is
 * too, so the escapes are for reading, not a reversible encoding — printable gives the six characters backslash, u, 0,
 * 0, 0, a and an LF the same text. The probe prints printableLines' lines behind a prefix. A value that is not a string
 * goes through JSON.stringify first, never String(). Text longer than `max` UTF-16 units is cut BEFORE escaping and
 * marked "...(+N)", so the escaped text stays small; a `max` that is not a non-negative safe integer means MAX_UNITS.
 * The JSON a value becomes is built whole before the cut, so printableJson's cost is the value's, not max's — its
 * indentation grows with nesting, and the probe bounds what it hands over. No export throws: anything that fails
 * prints as a fixed sentence.
 * A long value can still wrap in a narrow terminal — the probe's exit code is its verdict, not its text.
 *
 * Built without escape sequences in literals on purpose: this repo's authoring tools decode them inside file content.
 */

const BS = String.fromCodePoint(92);
const NL = String.fromCodePoint(10);
const CR = String.fromCodePoint(13);
/** What every export prints instead when a value cannot be printed — a caller can test for it. */
export const FALLBACK = '(a value that could not be printed)';
const HIDDEN = new RegExp(`[${BS}p{Cc}${BS}p{Cf}${BS}p{Zl}${BS}p{Zp}]`, 'gu');

/** How many UTF-16 units of a value are kept before escaping, unless the caller says otherwise. */
export const MAX_UNITS = 4096;

function show(ch) {
  const cp = ch.codePointAt(0);
  return cp > 0xffff ? `${BS}u{${cp.toString(16)}}` : `${BS}u${cp.toString(16).padStart(4, '0')}`;
}

function escapeHidden(text) {
  return text.replace(HIDDEN, show);
}

// Keep at most `max` units, never splitting a surrogate pair, and say how many were left out. A `max` that is not a
// non-negative safe integer means MAX_UNITS (a negative one would make slice count from the end).
function cut(text, max) {
  const limit = Number.isSafeInteger(max) && max >= 0 ? max : MAX_UNITS;
  if (text.length <= limit) return text;
  const last = text.charCodeAt(limit - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? limit - 1 : limit;
  return `${text.slice(0, end)}...(+${text.length - end})`;
}

// A value JSON cannot write (undefined, a function, a symbol) throws here, so the export's catch answers with FALLBACK
// whole — handed on as a string, it would be cut like any value, and a caller could not test for it.
function stringify(value, space) {
  const raw = JSON.stringify(value, null, space);
  if (typeof raw !== 'string') throw new TypeError('JSON cannot write this value');
  return raw;
}

/** One line: a string as it is, anything else as JSON — cut to `max` units, then every hidden character escaped. */
export function printable(value, max = MAX_UNITS) {
  try {
    return escapeHidden(cut(typeof value === 'string' ? value : stringify(value), max));
  } catch {
    return FALLBACK;
  }
}

/** JSON.stringify(value, null, 1) cut to `max` units, its own line breaks kept and each line escaped. */
export function printableJson(value, max = MAX_UNITS) {
  try {
    return cut(stringify(value, 1), max).split(NL).map(escapeHidden).join(NL);
  } catch {
    return FALLBACK;
  }
}

/** A raw text as lines: cut to `max` units, split on LF (a CR that ends a line dropped), each line escaped. */
export function printableLines(text, max = MAX_UNITS) {
  try {
    if (typeof text !== 'string') return [printable(text, max)];
    return cut(text, max).split(NL).map((line) => escapeHidden(line.endsWith(CR) ? line.slice(0, -1) : line));
  } catch {
    return [FALLBACK];
  }
}
