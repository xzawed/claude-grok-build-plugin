/**
 * scripts/printable.mjs is where the metered-billing probe makes a value it did not write itself safe to print; why it
 * exists: test/probe-metered-output.test.ts. What it hides is Unicode's control (Cc), format (Cf), line-separator (Zl)
 * and paragraph-separator (Zp) categories — defined again here, independently of the module.
 *
 * Special characters are built from numbers on purpose: this repo's authoring tools decode backslash-u escapes inside
 * file content, so an escape written in a literal would arrive in the file as the character itself.
 */
import { describe, it, expect } from 'vitest';
import { printable, printableJson, printableLines, MAX_UNITS, FALLBACK } from '../scripts/printable.mjs';

const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const cp = (n: number) => String.fromCodePoint(n);
const shown = (n: number) => (n > 0xffff ? `${BS}u{${n.toString(16)}}` : `${BS}u${n.toString(16).padStart(4, '0')}`);
const CATEGORIES = `[${BS}p{Cc}${BS}p{Cf}${BS}p{Zl}${BS}p{Zp}]`;
const isHidden = (c: string) => new RegExp(CATEGORIES, 'u').test(c);
const hiddenIn = (s: string) => [...s.matchAll(new RegExp(CATEGORIES, 'gu'))].map((m) => m[0].codePointAt(0));

describe('printable', () => {
  it('leaves ordinary text as it is — astral characters too', () => {
    for (const s of ['resp_01HZX', 'grok-4.6', 'completed', '', '청구됨 — ok', `a${BS}b "q"`, `${BS}u001b as text`, `ok ${cp(0x1f600)} ok`]) {
      expect(printable(s)).toBe(s);
    }
  });

  it('shows every BMP character of the hidden categories as a backslash-u escape, in place', () => {
    let seen = 0;
    for (let n = 0; n <= 0xffff; n++) {
      if (n >= 0xd800 && n <= 0xdfff) continue; // a lone surrogate is not a character
      if (!isHidden(cp(n))) continue;
      seen++;
      expect(printable(`a${cp(n)}b`)).toBe(`a${shown(n)}b`);
    }
    expect(seen).toBeGreaterThanOrEqual(100); // 110 on Node 22 (the exact set moves with the engine's Unicode version)
  });

  it('hides the ones that matter, by name', () => {
    // NUL, LF, CR, ESC, DEL, NEL, CSI, ALM, ZWSP, ZWJ, LRM, RLO, LS, PS, LRI, BOM
    for (const n of [0x00, 0x0a, 0x0d, 0x1b, 0x7f, 0x85, 0x9b, 0x061c, 0x200b, 0x200d, 0x200e, 0x202e, 0x2028, 0x2029, 0x2066, 0xfeff]) {
      expect(printable(cp(n))).toBe(shown(n));
    }
  });

  it('leaves other characters that show as nothing as they are — they can neither add a line nor drive a terminal', () => {
    // HANGUL FILLER, HANGUL CHOSEONG FILLER, COMBINING GRAPHEME JOINER, VARIATION SELECTOR-16
    for (const n of [0x3164, 0x115f, 0x034f, 0xfe0f]) expect(printable(`a${cp(n)}b`)).toBe(`a${cp(n)}b`);
  });

  it('shows astral format characters (the tags) with the braced escape', () => {
    for (const n of [0xe0001, 0xe0041, 0xe007f]) expect(printable(`x${cp(n)}y`)).toBe(`x${shown(n)}y`);
  });

  it('never returns a hidden character, for any single UTF-16 unit', () => {
    for (let n = 0; n <= 0xffff; n++) expect(hiddenIn(printable(String.fromCharCode(n)))).toEqual([]);
  });

  it('prints any other value as JSON first, then by the same rule — never through String()', () => {
    expect(printable(5)).toBe('5');
    expect(printable(null)).toBe('null');
    expect(printable(true)).toBe('true');
    expect(printable([1, 'a'])).toBe('[1,"a"]');
    // String() of this throws; the probe crashed on exactly this shape after a billed request
    expect(printable({ toString: 1 })).toBe('{"toString":1}');
    // JSON.stringify escapes C0 itself but leaves U+2028, C1 and format characters raw
    expect(printable({ a: `${cp(0x2028)}${cp(0x9b)}${cp(0x202e)}${cp(0x200b)}` }))
      .toBe(`{"a":"${shown(0x2028)}${shown(0x9b)}${shown(0x202e)}${shown(0x200b)}"}`);
    expect(printable({ a: NL })).toBe(`{"a":"${BS}n"}`);
  });

  it('cuts a long value to max units BEFORE escaping, says how much it left out, and never splits a pair', () => {
    expect(printable('x'.repeat(10), 4)).toBe('xxxx...(+6)');
    expect(printable('xxxx', 4)).toBe('xxxx'); // exactly max is not cut
    expect(printable(cp(0x1f600).repeat(3), 3)).toBe(`${cp(0x1f600)}...(+4)`); // ends on a high surrogate: one back
    expect(printable(cp(0x1f600).repeat(3), 4)).toBe(`${cp(0x1f600).repeat(2)}...(+2)`); // ends on a low one: kept
    // the first and the last pair there are, D800 DC00 and DBFF DFFF: both ends of the high range, each followed by a
    // low unit, DC00 the first past it (round-4 and round-5 review)
    expect(printable(cp(0x10000).repeat(3), 3)).toBe(`${cp(0x10000)}...(+4)`);
    expect(printable(cp(0x10000).repeat(3), 4)).toBe(`${cp(0x10000).repeat(2)}...(+2)`);
    expect(printable(cp(0x10ffff).repeat(3), 3)).toBe(`${cp(0x10ffff)}...(+4)`);
    expect(printable(cp(0x10ffff).repeat(3), 4)).toBe(`${cp(0x10ffff).repeat(2)}...(+2)`);
    const many = printable(cp(0x85).repeat(50_000));
    expect(many).toBe(`${shown(0x85).repeat(MAX_UNITS)}...(+${50_000 - MAX_UNITS})`);
  });

  it('takes a max that is not a non-negative safe integer as MAX_UNITS — a negative one would make slice count from the end', () => {
    for (const max of [-1, Number.NaN, 2.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(printable('hello', max)).toBe('hello');
      expect(printable('x'.repeat(MAX_UNITS + 10), max)).toBe(`${'x'.repeat(MAX_UNITS)}...(+10)`);
    }
    expect(printable('hello', 0)).toBe('...(+5)');
    expect(printable('x'.repeat(MAX_UNITS + 10), Number.MAX_SAFE_INTEGER)).toBe('x'.repeat(MAX_UNITS + 10));
  });

  it('keeps 4,096 units unless told otherwise (round-8 review)', () => {
    expect(MAX_UNITS).toBe(4096);
    expect(printable('x'.repeat(4096))).toBe('x'.repeat(4096));
    expect(printable('x'.repeat(4097))).toBe(`${'x'.repeat(4096)}...(+1)`);
  });

  it('is for reading, not a reversible encoding: a backslash prints as it is', () => {
    expect(printable(`${BS}u000a`)).toBe(printable(NL));
  });

  it('never throws, whatever it is handed', () => {
    const hostile: unknown[] = [
      undefined, 10n, Symbol('s'), () => 1, { toJSON() { throw new Error('no'); } },
      new Proxy({}, { get() { throw new Error('no'); }, ownKeys() { throw new Error('no'); } }),
    ];
    for (const v of hostile) {
      const out = printable(v);
      expect(typeof out).toBe('string');
      expect(hiddenIn(out)).toEqual([]);
    }
  });

  // FALLBACK is never cut, so a caller can always test for it — a short max included (round-7 review)
  it('answers FALLBACK whole for a value JSON cannot write, whatever max is', () => {
    for (const v of [undefined, Symbol('s'), () => 1, 10n]) {
      expect(printable(v, 10)).toBe(FALLBACK);
      expect(printableJson(v, 10)).toBe(FALLBACK);
      expect(printableLines(v, 10)).toEqual([FALLBACK]);
    }
  });
});

describe('printableJson', () => {
  it('is JSON.stringify(value, null, 1) when nothing is hidden and it fits — its own line breaks kept', () => {
    const v = { code: 'invalid-argument', error: 'Incorrect API key provided', n: [1, 2] };
    expect(printableJson(v)).toBe(JSON.stringify(v, null, 1));
  });

  it('shows what JSON.stringify leaves raw, without adding or removing a line', () => {
    const v = { error: `x${cp(0x2028)}y${cp(0x9b)}[2J${cp(0x202e)}z${cp(0xfeff)}`, more: 'ok' };
    const out = printableJson(v);
    expect(hiddenIn(out.split(NL).join(''))).toEqual([]);
    expect(out.split(NL)).toHaveLength(JSON.stringify(v, null, 1).split(NL).length);
    expect(out).toContain(`x${shown(0x2028)}y${shown(0x9b)}[2J${shown(0x202e)}z${shown(0xfeff)}`);
  });

  it('cuts to max units before escaping, and says so', () => {
    const v = { e: 'y'.repeat(5000) };
    expect(printableJson(v, 100)).toBe(`${JSON.stringify(v, null, 1).slice(0, 100)}...(+${JSON.stringify(v, null, 1).length - 100})`);
    // with something to escape, the order shows: 20 units kept, then escaped (round-7 review)
    expect(printableJson({ a: cp(0x85).repeat(5000) }, 20)).toBe(`{${NL} "a": "${shown(0x85).repeat(11)}...(+4992)`);
  });

  it('never throws, whatever it is handed — and says so with FALLBACK, which a caller can test for', () => {
    expect(printableJson(10n)).toBe(FALLBACK);
    expect(printableJson(undefined)).toBe(FALLBACK);
    for (const v of [undefined, 10n, { toJSON() { throw new Error('no'); } }]) {
      const out = printableJson(v);
      expect(typeof out).toBe('string');
      expect(hiddenIn(out.split(NL).join(''))).toEqual([]);
    }
  });
});

describe('printableLines', () => {
  it('keeps a text’s own lines, drops the CR of a CRLF, and escapes everything else', () => {
    expect(printableLines(`a${CR}${NL}b${cp(27)}[2J${NL}${CR}c`)).toEqual(['a', `b${shown(27)}[2J`, `${shown(13)}c`]);
    // only the one CR that ends the line is dropped; another before it is shown (round-7 review)
    expect(printableLines(`a${CR}${CR}${NL}b`)).toEqual([`a${shown(13)}`, 'b']);
  });

  it('cuts before it splits', () => {
    expect(printableLines(`${'x'.repeat(10)}${NL}tail`, 4)).toEqual(['xxxx...(+11)']);
  });

  it('cuts before it escapes — 10 units kept of 50,000 to escape (round-7 review)', () => {
    expect(printableLines(cp(0x85).repeat(50_000), 10)).toEqual([`${shown(0x85).repeat(10)}...(+49990)`]);
  });

  it('gives a value that is not a string one printable line, cut to max, and never throws (round-10 review)', () => {
    expect(printableLines({ toString: 1 })).toEqual(['{"toString":1}']);
    expect(printableLines(10n)).toEqual(['(a value that could not be printed)']);
    expect(printableLines({ a: 'x'.repeat(50) }, 10)).toEqual(['{"a":"xxxx...(+48)']);
  });
});
