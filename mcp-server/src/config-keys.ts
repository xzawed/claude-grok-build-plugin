/**
 * Per-model credentials in grok's config.toml — the one metered path the subscription env scrub
 * cannot reach. Done criteria and scope: docs/specs/2026-09-24-config-model-keys-billing-caveat.md.
 *
 * MEASURED (grok-cli-contract.md §10): a `[model."<id>"]` table with its own `api_key`, or with an
 * `env_key` naming a variable that is set, is used BEFORE the subscription session. On 1.0.13, with a
 * real session, the debug log said auth_type=ApiKey where a keyless run says SessionToken. On 1.0.41
 * grok marks exactly the models with a live key of their own model_byok="byok" and the rest
 * "not_byok" (auth_type alone did not tell them apart in that setup). grok's docs give the same
 * order. `billing` cannot say so — it is billingFor(mode) by design, never an observation — so this
 * module tells the user beside it. It never stops the run: the owner chose to warn, not to block,
 * and a user may well want exactly that model on that key.
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
 * Checked 2026-09-24 against an independent parser (smol-toml, TOML 1.1, ties broken with Python's
 * tomllib) and the official toml-test corpus. Pre-merge review then found a class my generator never
 * produced — a header under an array of tables, below — so a zero from that comparison is only as
 * wide as its generator. Re-run it, with its axes widened, before changing this reader (CHANGELOG,
 * v0.2.33).
 */
import { closeSync, openSync, readSync, statSync } from 'node:fs';
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
  | {
    reason: 'config_model_keys'; configPath: string; models: ModelCredential[];
    /** Set only when more models were found than `models` lists (CAVEAT_MODEL_LIMIT). */
    modelsOmitted?: number;
    message: string;
  }
  | { reason: 'config_unreadable'; configPath: string; message: string };

/**
 * Far above any real config.toml. Past it — or when the path is not a regular file at all — the
 * file is reported as not checked instead of read; see readRegularFileCapped.
 */
export const CONFIG_READ_LIMIT_BYTES = 1024 * 1024;

/**
 * How many models one caveat names. The caveat rides on every status and delegate/plan/verify
 * result, so an absurd config must not turn each of them into megabytes (review, 2026-09-24:
 * 50k listed models made a 4.3M-character status). The rest are counted, never silently dropped.
 */
export const CAVEAT_MODEL_LIMIT = 20;

/**
 * Longest model id or variable name a caveat repeats. The count cap alone still let 20 long ids
 * make a 2M-character caveat (re-review); a longer name is cut here and marked with "…".
 */
export const CAVEAT_NAME_LIMIT = 200;
const clipName = (s: string) => (s.length > CAVEAT_NAME_LIMIT ? `${s.slice(0, CAVEAT_NAME_LIMIT)}…` : s);

class TomlScanError extends Error {}

/**
 * `null`: nothing under here can declare a model credential — inside an array, an array of
 * tables, or already deeper than `model / <id> / <field>`.
 */
type Path = string[] | null;

/** The only depth a credential lives at: model / <id> / api_key|env_key. */
const CREDENTIAL_DEPTH = 3;

// Joining a table path and a key path, or giving up once the result could never be a credential.
// FOUND IN RE-REVIEW: copying every table path onto every key cost depth x keys — a valid 1 MB file
// (a 200k-part header, then 59k keys) took 50 s, all of it before a spawn. Past the credential
// depth the path is never used, so it is never built.
function extend(path: Path, key: string[]): Path {
  if (path === null || path.length + key.length > CREDENTIAL_DEPTH) return null;
  return [...path, ...key];
}

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
  /** `[[…]]` paths short enough to prefix a table that could still hold a credential, as JSON. */
  private readonly arraysOfTables = new Set<string>();

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
        // FOUND IN PRE-MERGE REVIEW (two reviewers, separately; confirmed against smol-toml and
        // tomllib): a header whose path starts with an array of tables names a table inside that
        // array's LAST element. After `[[model]]`, `[model."x"]` is model[-1].x, not model x.
        // grok 1.0.41 agrees that no model table exists then: it warns "`model` must be a table of
        // [model.<id>] entries, got array; all model overrides ignored", and no key is used
        // (measured). So nothing under such a prefix can declare a model credential.
        //
        // FOUND IN RE-REVIEW of that fix: comparing each header with every earlier `[[…]]` path was
        // quadratic — 96k array headers in a valid 1 MB file took 27 s, the same stall as the FIFO.
        // Only a table of at most CREDENTIAL_DEPTH - 1 parts can still hold a credential key (a
        // longer one only yields deeper paths), so only such headers are kept, only such array
        // paths are remembered, and a header needs at most two lookups.
        const shallow = path.length < CREDENTIAL_DEPTH;
        const underArray = shallow
          && path.some((_, k) => this.arraysOfTables.has(JSON.stringify(path.slice(0, k + 1))));
        if (arrayOfTables && shallow) this.arraysOfTables.add(JSON.stringify(path));
        table = arrayOfTables || underArray || !shallow ? null : path;
        this.lineEnd();
        continue;
      }
      const key = this.keyPath();
      this.expect('=');
      this.skipBlank();
      this.value(extend(table, key));
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

  // Plain runs are appended as slices, not character by character: review measured 0.79 s for one
  // 8 MB string the old way, and this runs before every spawn.
  private basicString(): string {
    this.i++;
    let out = '';
    let start = this.i;
    for (;;) {
      const c = this.peek();
      if (c === undefined || c === '\n') this.fail('unterminated string');
      if (c === '"') {
        out += this.s.slice(start, this.i);
        this.i++;
        return out;
      }
      if (c === '\\') {
        out += this.s.slice(start, this.i);
        this.i++;
        out += this.escape();
        start = this.i;
        continue;
      }
      this.i++;
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
    let start = this.i;
    for (;;) {
      if (this.i >= this.s.length) this.fail('unterminated multi-line string');
      if (this.at(delim)) {
        out += this.s.slice(start, this.i);
        // Up to two quotes may sit just before the closing delimiter; they belong to the content.
        let run = 0;
        while (this.peek() === delim[0]) {
          run++;
          this.i++;
        }
        return out + delim[0].repeat(Math.min(run - 3, 2));
      }
      if (escapes && this.s[this.i] === '\\') {
        out += this.s.slice(start, this.i);
        this.i++;
        if (!this.lineEndingBackslash()) out += this.escape();
        start = this.i;
        continue;
      }
      this.i++;
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
      this.value(extend(path, key));
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
// The lower-case index is built once per call, not rescanned per name (review measured 9.8 s for
// 50 models x 2000 names x 2000 variables the other way).
function envResolver(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): (name: string) => string | undefined {
  const exact = (name: string) => (Object.hasOwn(env, name) ? env[name] : undefined);
  if (platform !== 'win32') return exact;
  const byLower = new Map<string, string>();
  for (const k of Object.keys(env)) {
    if (!byLower.has(k.toLowerCase())) byLower.set(k.toLowerCase(), k);
  }
  return (name) => {
    if (Object.hasOwn(env, name)) return env[name];
    const key = byLower.get(name.toLowerCase());
    return key === undefined ? undefined : env[key];
  };
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
  const lookup = envResolver(childEnv, platform);
  // A Set beside the array: `order.includes` made this quadratic (review: 8.8 s at 100k models).
  const order: string[] = [];
  const seen = new Set<string>();
  const best = new Map<string, ModelCredential>();
  for (const d of decls) {
    if (!seen.has(d.model)) {
      seen.add(d.model);
      order.push(d.model);
    }
    if (d.via === 'api_key') {
      if (d.nonEmpty) best.set(d.model, { model: d.model, via: 'api_key' });
      continue;
    }
    if (best.has(d.model)) continue;
    const envVar = d.names.find((n) => (lookup(n) ?? '') !== '');
    if (envVar !== undefined) best.set(d.model, { model: d.model, via: 'env_key', envVar });
  }
  return order.flatMap((m) => {
    const c = best.get(m);
    return c ? [c] : [];
  });
}

/**
 * Read `path` only when it is a regular file of at most `limit` bytes; throw otherwise (a missing
 * file keeps its ENOENT, which the caller treats as "no config").
 *
 * FOUND IN PRE-MERGE REVIEW (reproduced on Linux, 2026-09-24): a plain readFileSync on a FIFO with no
 * writer, or on a link to /dev/zero, never returns. It ran synchronously before every spawn and in
 * every status call, so the whole server stopped answering — route too — until restart; main never
 * read this file, so this feature had introduced it. `stat` does not open the file and so does not
 * block on a FIFO the way `open` does; anything but a regular file is refused before it is opened.
 * The read is bounded by the size stat reported, so a file that grows mid-read is not followed.
 * Not covered: the path being swapped for a FIFO between the stat and the open — that takes write
 * access to the user's grok home, where far worse is possible.
 */
export function readRegularFileCapped(path: string, limit: number): string {
  const st = statSync(path);
  if (!st.isFile()) throw new TomlScanError('config.toml: not a regular file');
  if (st.size > limit) throw new TomlScanError('config.toml: larger than the read limit');
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(st.size + 1);
    let n = 0;
    while (n < buf.length) {
      const r = readSync(fd, buf, n, buf.length - n, null);
      if (r === 0) break;
      n += r;
    }
    if (n > st.size) throw new TomlScanError('config.toml: changed while being read');
    return buf.toString('utf8', 0, n);
  } finally {
    closeSync(fd);
  }
}

export interface BillingCaveatDeps {
  readFile: (path: string) => string;
  platform: NodeJS.Platform;
}

export const defaultBillingCaveatDeps: BillingCaveatDeps = {
  readFile: (path) => readRegularFileCapped(path, CONFIG_READ_LIMIT_BYTES),
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
    const listed = models.slice(0, CAVEAT_MODEL_LIMIT).map((c) => ({
      ...c,
      model: clipName(c.model),
      ...(c.envVar === undefined ? {} : { envVar: clipName(c.envVar) }),
    }));
    const omitted = models.length - listed.length;
    const named = listed.map(credentialLabel).join(', ') + (omitted > 0 ? ` 외 ${omitted}개` : '');
    return {
      reason: 'config_model_keys',
      configPath,
      models: listed,
      ...(omitted > 0 ? { modelsOmitted: omitted } : {}),
      message:
        `grok 설정(${configPath})에 자체 자격증명을 가진 모델이 있습니다: ${named}. `
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
