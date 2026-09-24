/**
 * Per-model credentials in grok's config.toml — the one metered path the subscription env scrub
 * cannot reach. Done criteria and scope: docs/specs/2026-09-24-config-model-keys-billing-caveat.md.
 *
 * MEASURED (grok-cli-contract.md §10 — 1.0.13, re-measured on 1.0.30 and 1.0.41 on 2026-09-24): a
 * `[model."<id>"]` table with its own `api_key`, or with an `env_key` naming a variable that is set,
 * is used BEFORE a live subscription session (grok's debug log: auth_type=ApiKey,
 * has_api_key=true). grok's own docs give the same order. `billing` cannot say so — it is
 * billingFor(mode) by design, never an observation — so this module tells the user beside it.
 * It never stops the run: the owner chose to warn, not to block, and a user may well want exactly
 * that model on that key.
 *
 * Why a hand-rolled reader and not a TOML library: a library would be inlined into dist/index.js
 * as a third runtime dependency, in a tree where installing one is itself a known hazard
 * (CLAUDE.md Gotchas: npm 10.9.3, --no-save). The question is small — which
 * `model / <id> / api_key|env_key` paths exist — but answering it still means following TOML's
 * structure. A multi-line string can hold a line that looks like a table header, and the unquoted
 * `[model.grok-4.6]` is `model."grok-4"."6"`, which grok ignores (§10 TOML trap). So this reader
 * follows structure to the spec, and does not validate what it only steps over (numbers, dates,
 * bare-key characters). That leniency only ever accepts a file TOML forbids, and grok refuses such
 * a file outright — measured on 1.0.41: the run stops with "Failed to load config: TOML parse
 * error", no model is called — so nothing is billed whatever this reports about it.
 *
 * Checked 2026-09-24 against an independent parser (smol-toml, TOML 1.1): 80,008 generated
 * documents with no disagreement, and no throw on any valid document of the official toml-test
 * corpus (1.0.0 and 1.1.0). The harness caught three deliberate bugs, so its zero is not blindness.
 * Re-run that comparison before changing this reader (CHANGELOG, v0.2.33).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGrokEnv, grokHome } from './env.js';
import type { AuthMode } from './types.js';

/** A credential a `model.<id>` table declares, before asking whether grok could use it. */
export type ModelCredentialDecl =
  | { model: string; via: 'api_key'; nonEmpty: boolean }
  | { model: string; via: 'env_key'; names: string[] };

/** A model grok would call with its own credential instead of the subscription session. */
export interface ModelCredential {
  /** The id as written in `[model."<id>"]`. */
  model: string;
  via: 'api_key' | 'env_key';
  /** env_key only: the variable grok would read. Its NAME — the value is never carried. */
  envVar?: string;
}

export type BillingCaveat =
  | { reason: 'config_model_keys'; configPath: string; models: ModelCredential[]; message: string }
  | { reason: 'config_unreadable'; configPath: string; message: string };

class TomlScanError extends Error {}

/** `null`: nothing under here can be a model table (inside an array, or an array of tables). */
type Path = string[] | null;

// TOML's bare keys are [A-Za-z0-9_-]. Stopping only at structure also accepts keys TOML forbids
// (e.g. non-ASCII bare keys); grok refuses such a file before any model call (see the header).
const KEY_STOP = new Set([' ', '\t', '\r', '\n', '.', '=', '[', ']', '{', '}', '"', "'", '#', ',']);
const VALUE_STOP = new Set([' ', '\t', '\r', '\n', ',', ']', '}', '#']);
const HEX_DIGITS = '0123456789abcdefABCDEF';

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
const isHex = (s: string) => [...s].every((c) => HEX_DIGITS.includes(c));
// YYYY-MM-DD, the only shape after which TOML lets a space separate the time.
const isDate = (s: string) =>
  s.length === 10 && s[4] === '-' && s[7] === '-'
  && [0, 1, 2, 3, 5, 6, 8, 9].every((k) => isDigit(s[k]));

class Reader {
  private i = 0;
  private readonly s: string;
  private readonly decls: ModelCredentialDecl[] = [];

  constructor(text: string) {
    this.s = text.codePointAt(0) === 0xfeff ? text.slice(1) : text;
  }

  // A line number only. The text around a fault may be the key itself (absolute principle #4).
  private fail(what: string): never {
    let line = 1;
    for (let k = 0; k < this.i && k < this.s.length; k++) if (this.s[k] === '\n') line++;
    throw new TomlScanError(`config.toml: ${what} (line ${line})`);
  }

  private peek(ahead = 0): string | undefined {
    return this.s[this.i + ahead];
  }

  private at(token: string): boolean {
    return this.s.startsWith(token, this.i);
  }

  private expect(ch: string): void {
    if (this.peek() !== ch) this.fail(`expected ${ch}`);
    this.i++;
  }

  /** Spaces, tabs and the CR of a CRLF — never a newline. */
  private skipBlank(): void {
    for (let c = this.peek(); c === ' ' || c === '\t' || c === '\r'; c = this.peek()) this.i++;
  }

  private skipComment(): void {
    while (this.i < this.s.length && this.s[this.i] !== '\n') this.i++;
  }

  /** Between statements, and inside arrays and inline tables: blanks, newlines and comments. */
  private skipAll(): void {
    for (;;) {
      this.skipBlank();
      const c = this.peek();
      if (c === '\n') this.i++;
      else if (c === '#') this.skipComment();
      else return;
    }
  }

  private lineEnd(): void {
    this.skipBlank();
    if (this.peek() === '#') this.skipComment();
    const c = this.peek();
    if (c !== undefined && c !== '\n') this.fail('expected the end of the line');
  }

  document(): ModelCredentialDecl[] {
    let table: Path = [];
    for (;;) {
      this.skipAll();
      if (this.peek() === undefined) return this.decls;
      if (this.peek() === '[') {
        const arrayOfTables = this.peek(1) === '[';
        this.i += arrayOfTables ? 2 : 1;
        const path = this.keyPath();
        this.expect(']');
        if (arrayOfTables) this.expect(']');
        table = arrayOfTables ? null : path;
        this.lineEnd();
        continue;
      }
      const key = this.keyPath();
      this.expect('=');
      this.skipBlank();
      this.value(table === null ? null : [...table, ...key]);
      this.lineEnd();
    }
  }

  private keyPath(): string[] {
    const parts: string[] = [];
    for (;;) {
      this.skipBlank();
      parts.push(this.simpleKey());
      this.skipBlank();
      if (this.peek() !== '.') return parts;
      this.i++;
    }
  }

  private simpleKey(): string {
    const c = this.peek();
    if (c === '"' || c === "'") {
      if (this.at('"""') || this.at("'''")) this.fail('a multi-line string cannot be a key');
      return c === '"' ? this.basicString() : this.literalString();
    }
    const start = this.i;
    while (this.i < this.s.length && !KEY_STOP.has(this.s[this.i])) this.i++;
    if (this.i === start) this.fail('expected a key');
    return this.s.slice(start, this.i);
  }

  private value(path: Path): void {
    const c = this.peek();
    if (c === '"' || c === "'") return this.record(path, this.string());
    if (c === '[') return this.record(path, this.array());
    if (c === '{') {
      this.inlineTable(path);
      return this.record(path, undefined);
    }
    this.scalar();
    this.record(path, undefined);
  }

  // The only place a credential is noticed. An api_key's text is reduced to "is there one" on the
  // spot, so no key outlives the scan.
  private record(path: Path, value: string | (string | null)[] | undefined): void {
    if (path === null || path.length !== 3 || path[0] !== 'model') return;
    const [, model, field] = path;
    if (field === 'api_key') {
      this.decls.push({ model, via: 'api_key', nonEmpty: typeof value === 'string' && value.trim() !== '' });
    } else if (field === 'env_key') {
      let names: string[] = [];
      if (typeof value === 'string') names = [value];
      else if (Array.isArray(value)) names = value.filter((v): v is string => typeof v === 'string');
      this.decls.push({ model, via: 'env_key', names });
    }
  }

  private string(): string {
    if (this.at('"""')) return this.multiLine('"""', true);
    if (this.at("'''")) return this.multiLine("'''", false);
    return this.peek() === '"' ? this.basicString() : this.literalString();
  }

  private basicString(): string {
    this.i++;
    let out = '';
    for (;;) {
      const c = this.peek();
      if (c === undefined || c === '\n') this.fail('unterminated string');
      this.i++;
      if (c === '"') return out;
      out += c === '\\' ? this.escape() : c;
    }
  }

  private literalString(): string {
    this.i++;
    const start = this.i;
    for (;;) {
      const c = this.peek();
      if (c === undefined || c === '\n') this.fail('unterminated string');
      this.i++;
      if (c === "'") return this.s.slice(start, this.i - 1);
    }
  }

  private multiLine(delim: '"""' | "'''", escapes: boolean): string {
    this.i += 3;
    // A newline right after the opening delimiter is not part of the string.
    if (this.peek() === '\n') this.i += 1;
    else if (this.peek() === '\r' && this.peek(1) === '\n') this.i += 2;
    let out = '';
    for (;;) {
      if (this.i >= this.s.length) this.fail('unterminated multi-line string');
      if (this.at(delim)) {
        // Up to two quotes may sit just before the closing delimiter; they belong to the content.
        let run = 0;
        while (this.peek() === delim[0]) {
          run++;
          this.i++;
        }
        return out + delim[0].repeat(Math.min(run - 3, 2));
      }
      const c = this.s[this.i++];
      if (escapes && c === '\\') {
        if (!this.lineEndingBackslash()) out += this.escape();
        continue;
      }
      out += c;
    }
  }

  /** `\` + optional blanks + newline swallows every following blank and newline. */
  private lineEndingBackslash(): boolean {
    let k = this.i;
    while (this.s[k] === ' ' || this.s[k] === '\t') k++;
    if (this.s[k] === '\r') k++;
    if (this.s[k] !== '\n') return false;
    while (k < this.s.length && [' ', '\t', '\r', '\n'].includes(this.s[k])) k++;
    this.i = k;
    return true;
  }

  // Called with the backslash already consumed. TOML 1.0's escapes plus 1.1's \e and \x; anything
  // else is an invalid file, which grok would reject too.
  private escape(): string {
    const c = this.peek();
    if (c === undefined) this.fail('unterminated escape');
    this.i++;
    switch (c) {
      case 'b': return '\b';
      case 't': return '\t';
      case 'n': return '\n';
      case 'f': return '\f';
      case 'r': return '\r';
      case 'e': return String.fromCodePoint(27);
      case '"': return '"';
      case '\\': return '\\';
      case 'x': return this.hexEscape(2);
      case 'u': return this.hexEscape(4);
      case 'U': return this.hexEscape(8);
      default: return this.fail('invalid escape');
    }
  }

  private hexEscape(digits: number): string {
    const h = this.s.slice(this.i, this.i + digits);
    if (h.length !== digits || !isHex(h)) this.fail('invalid escape');
    this.i += digits;
    const cp = Number.parseInt(h, 16);
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) this.fail('invalid escape');
    return String.fromCodePoint(cp);
  }

  /** Element strings are returned (env_key may be an array); anything else is a `null` slot. */
  private array(): (string | null)[] {
    this.i++;
    const out: (string | null)[] = [];
    for (;;) {
      this.skipAll();
      if (this.peek() === ']') {
        this.i++;
        return out;
      }
      const c = this.peek();
      if (c === '"' || c === "'") out.push(this.string());
      else if (c === '[') {
        this.array();
        out.push(null);
      } else if (c === '{') {
        this.inlineTable(null);
        out.push(null);
      } else {
        this.scalar();
        out.push(null);
      }
      this.skipAll();
      if (this.peek() === ',') this.i++;
      else if (this.peek() === ']') {
        this.i++;
        return out;
      } else this.fail('expected , or ] in an array');
    }
  }

  // Newlines between pairs are TOML 1.1; a 1.0 file never has them, so accepting them costs nothing.
  private inlineTable(path: Path): void {
    this.i++;
    for (;;) {
      this.skipAll();
      if (this.peek() === '}') {
        this.i++;
        return;
      }
      const key = this.keyPath();
      this.expect('=');
      this.skipBlank();
      this.value(path === null ? null : [...path, ...key]);
      this.skipAll();
      if (this.peek() === ',') this.i++;
      else if (this.peek() === '}') {
        this.i++;
        return;
      } else this.fail('expected , or } in an inline table');
    }
  }

  /** Numbers, booleans, dates: stepped over, never interpreted. */
  private scalar(): void {
    const start = this.i;
    while (this.i < this.s.length && !VALUE_STOP.has(this.s[this.i])) this.i++;
    if (this.i === start) this.fail('expected a value');
    // A date-time may put ONE space between date and time: `1979-05-27 07:32:00Z`.
    if (isDate(this.s.slice(start, this.i)) && this.peek() === ' ' && isDigit(this.peek(1))) {
      this.i++;
      while (this.i < this.s.length && !VALUE_STOP.has(this.s[this.i])) this.i++;
    }
  }
}

/** Every `model / <id> / api_key|env_key` the file declares. Throws on a file it cannot read as TOML. */
export function modelCredentialDecls(text: string): ModelCredentialDecl[] {
  return new Reader(text).document();
}

// grok reads variables through the OS, and win32 names are case-insensitive — so a config naming
// `openai_api_key` finds OPENAI_API_KEY there, and only there. The exact spelling is tried first.
function envLookup(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string | undefined {
  if (Object.hasOwn(env, name)) return env[name];
  if (platform !== 'win32') return undefined;
  const lower = name.toLowerCase();
  const key = Object.keys(env).find((k) => k.toLowerCase() === lower);
  return key === undefined ? undefined : env[key];
}

/**
 * The credentials grok would actually hold, one per model, in the order the file first names each.
 * grok's documented order is the model's api_key, then its env_key ("the first set, non-empty value
 * wins"), then the session — so an api_key outranks an env_key wherever either is written.
 */
export function liveModelCredentials(
  decls: readonly ModelCredentialDecl[],
  childEnv: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): ModelCredential[] {
  const order: string[] = [];
  const best = new Map<string, ModelCredential>();
  for (const d of decls) {
    if (!order.includes(d.model)) order.push(d.model);
    if (d.via === 'api_key') {
      if (d.nonEmpty) best.set(d.model, { model: d.model, via: 'api_key' });
      continue;
    }
    if (best.has(d.model)) continue;
    const envVar = d.names.find((n) => (envLookup(childEnv, n, platform) ?? '') !== '');
    if (envVar !== undefined) best.set(d.model, { model: d.model, via: 'env_key', envVar });
  }
  return order.flatMap((m) => {
    const c = best.get(m);
    return c ? [c] : [];
  });
}

export interface BillingCaveatDeps {
  readFile: (path: string) => string;
  platform: NodeJS.Platform;
}

export const defaultBillingCaveatDeps: BillingCaveatDeps = {
  readFile: (path) => readFileSync(path, 'utf8'),
  platform: process.platform,
};

const credentialLabel = (c: ModelCredential) =>
  c.via === 'api_key' ? `${c.model} (api_key)` : `${c.model} (env_key → ${c.envVar})`;

/**
 * The caveat to set beside `billing`, or `undefined` when there is nothing to qualify. Never throws
 * for a bad file: it reports that the file could not be checked instead.
 */
export function configBillingCaveat(
  mode: AuthMode,
  env: NodeJS.ProcessEnv,
  deps: BillingCaveatDeps = defaultBillingCaveatDeps,
): BillingCaveat | undefined {
  // api mode already says metered_api. The caveat exists to qualify a "subscription" tag.
  if (mode !== 'subscription') return undefined;
  const configPath = join(grokHome(env), 'config.toml');
  try {
    let text: string;
    try {
      text = deps.readFile(configPath);
    } catch (e) {
      // No file: grok runs on its built-in defaults, so there is no per-model key to find.
      if ((e as NodeJS.ErrnoException | null)?.code === 'ENOENT') return undefined;
      throw e;
    }
    // Judged against the env grok will actually get, so a model pointing at XAI_API_KEY — which
    // the subscription strip removes — is correctly not reported.
    const models = liveModelCredentials(modelCredentialDecls(text), buildGrokEnv(mode, env), deps.platform);
    if (models.length === 0) return undefined;
    return {
      reason: 'config_model_keys',
      configPath,
      models,
      message:
        `grok 설정(${configPath})에 자체 자격증명을 가진 모델이 있습니다: ${models.map(credentialLabel).join(', ')}. `
        + 'grok 문서의 자격증명 순서에서 모델 자체 자격증명은 구독 세션보다 앞서므로, 그 모델로 도는 위임은 '
        + 'billing이 "subscription"이어도 구독이 아니라 그 키로(종량제) 청구될 수 있습니다. 실행은 막지 않습니다 — '
        + '의도한 설정이 아니면 해당 [model."…"] 절에서 api_key·env_key를 지우세요.',
    };
  } catch {
    // Could not read, or could not parse. "Could not ask" is not "nothing there" (CLAUDE.md), so
    // say so — and never let it reach the run it is annotating.
    return {
      reason: 'config_unreadable',
      configPath,
      message:
        `grok 설정(${configPath})을 읽거나 해석하지 못해, 모델별 자격증명(api_key·env_key)이 구독 대신 `
        + '쓰이는지 확인하지 못했습니다. billing은 설정된 모드만 말합니다.',
    };
  }
}
