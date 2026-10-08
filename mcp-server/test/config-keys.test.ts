/**
 * config.toml per-model credentials → `billingCaveat` (v0.2.33).
 * Done criteria: docs/specs/2026-09-24-config-model-keys-billing-caveat.md.
 *
 * The premise is measured, not assumed: a `[model."<id>"]` api_key / env_key outranks a live
 * subscription session, and the env scrub cannot reach it (grok-cli-contract.md §10 — 1.0.13 with a
 * real session, auth_type=ApiKey against SessionToken; 1.0.41, model_byok="byok" for exactly those
 * models). `npm run probe:contract` cannot re-check that premise, so these tests pin the half that
 * is ours: how the plugin READS the file, and that reading it never costs the user a run or leaks
 * the key it found.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import {
  modelCredentialDecls,
  liveModelCredentials,
  configBillingCaveat,
  readRegularFileCapped,
  CAVEAT_MODEL_LIMIT,
  CAVEAT_NAME_LIMIT,
  type BillingCaveatDeps,
  type CredentialDecl,
} from '../src/config-keys.js';

// A literal backslash, built at runtime so no layer between the editor and the file can fold it.
const BS = String.fromCharCode(92);
const toml = (...lines: string[]) => lines.join('\n');
const errno = (code: string) => Object.assign(new Error(code), { code });

describe('modelCredentialDecls — reads the file the way grok does', () => {
  it('reads the documented quoted form', () => {
    expect(modelCredentialDecls(toml('[model."grok-4.7"]', 'api_key = "xai-bogus"')))
      .toEqual([{ model: 'grok-4.7', via: 'api_key', nonEmpty: true }]);
  });

  // Contract §10 TOML trap, measured: `[model.grok-4.6]` parses as `model.grok-4` with a field `6`,
  // and grok ignores it (`grok inspect`: key=grok-4 field=6). Reporting it would be a false alarm
  // about a key grok never sends.
  it('does not report the unquoted dotted id that grok silently ignores', () => {
    expect(modelCredentialDecls(toml('[model.grok-4.6]', 'api_key = "x"'))).toEqual([]);
    expect(modelCredentialDecls(toml('model.grok-4.6.api_key = "x"'))).toEqual([]);
  });

  it('treats a bare id without dots as the real model table it is', () => {
    expect(modelCredentialDecls(toml('[model.my-gateway]', 'env_key = "GATEWAY_API_KEY"')))
      .toEqual([{ model: 'my-gateway', via: 'env_key', names: ['GATEWAY_API_KEY'] }]);
  });

  it('reaches the same table through dotted keys, inline tables and literal strings', () => {
    const forms = [
      toml('model."grok-4.7".api_key = "x"'),
      toml('[model]', '"grok-4.7".api_key = "x"'),
      toml('[model]', '"grok-4.7" = { api_key = "x" }'),
      toml('model = { "grok-4.7" = { api_key = "x" } }'),
      toml("[model.'grok-4.7']", "api_key = 'x'"),
      toml('[ model . "grok-4.7" ]', 'api_key="x"'),
    ];
    for (const f of forms) {
      expect(modelCredentialDecls(f), f).toEqual([{ model: 'grok-4.7', via: 'api_key', nonEmpty: true }]);
    }
  });

  it('reads env_key as a string or as an array spread over lines with comments', () => {
    const text = toml(
      '[model."claude-gw"]',
      'env_key = [',
      '  "ANTHROPIC_AUTH_TOKEN", # primary',
      '  "LC_ANTHROPIC_AUTH_TOKEN",',
      ']',
    );
    expect(modelCredentialDecls(text)).toEqual([
      { model: 'claude-gw', via: 'env_key', names: ['ANTHROPIC_AUTH_TOKEN', 'LC_ANTHROPIC_AUTH_TOKEN'] },
    ]);
  });

  it('ignores keys that only look like a model credential', () => {
    const text = toml(
      '# api_key = "commented out"',
      '[models]',
      'default = "grok-4.5"',
      '[model."m"]',
      'events_api_key = "t"',
      'extra_headers = { "x-api-key" = "sk" }',
      'auth_provider = "bedrock"',
      '[model."m".nested]',
      'api_key = "deeper than a model table"',
      '[telemetry]',
      'api_key = "not under model"',
      '[[model."arr"]]',
      'api_key = "an array of tables is not a model table"',
    );
    expect(modelCredentialDecls(text)).toEqual([]);
  });

  // FOUND IN PRE-MERGE REVIEW by two reviewers separately, confirmed against smol-toml and tomllib:
  // after `[[model]]`, `[model."x"]` names a table inside the array's last element, not model x.
  // grok 1.0.41 then ignores every model override ("`model` must be a table … got array"; no key
  // used — measured). The first version reported "x" here: a false alarm about a key never sent.
  it('reads nothing as a model table under an array of tables', () => {
    expect(modelCredentialDecls(toml('[[model]]', '[model."x"]', 'api_key = "k"'))).toEqual([]);
    expect(modelCredentialDecls(toml('[[model]]', 'name = "profile"', '[model."grok-4.7"]', 'api_key = "k"'))).toEqual([]);
    expect(modelCredentialDecls(toml('[[model."m".efforts]]', '[model."m".efforts.sub]', 'api_key = "k"'))).toEqual([]);
    // A real model table next to, or above, such an array still counts.
    expect(modelCredentialDecls(toml('[[model."m".efforts]]', 'name = "high"', '[model."m"]', 'api_key = "k"')))
      .toEqual([{ model: 'm', via: 'api_key', nonEmpty: true }]);
    expect(modelCredentialDecls(toml('[[a]]', '[[a.b]]', 'k = 1', '[model."x"]', 'api_key = "k"')))
      .toEqual([{ model: 'x', via: 'api_key', nonEmpty: true }]);
  });

  // Review mutation-tested the path check: removing the `model` root test, or relaxing "exactly
  // three parts", left every earlier test green. A51 added a second root, so each guard now holds
  // for both roots: another root, a shallower or deeper path, and a link that is not a string.
  it('counts model|model_providers / <id> / field only — not another root, and not deeper', () => {
    expect(modelCredentialDecls(toml('[providers."x"]', 'api_key = "k"'))).toEqual([]);
    expect(modelCredentialDecls(toml('[model_provider."x"]', 'api_key = "k"'))).toEqual([]);
    expect(modelCredentialDecls(toml('[telemetry]', 'model_provider = "p"'))).toEqual([]);
    expect(modelCredentialDecls(toml('[model."m".api_key]', 'value = "x"'))).toEqual([]);
    expect(modelCredentialDecls(toml('[model_providers."p".api_key]', 'value = "x"'))).toEqual([]);
    expect(modelCredentialDecls(toml('[model_providers]', 'api_key = "k"', 'env_key = "K"'))).toEqual([]);
    expect(modelCredentialDecls(toml('[model]', 'model_provider = "p"'))).toEqual([]);
    expect(modelCredentialDecls(toml('[model."m".x]', 'model_provider = "p"'))).toEqual([]);
    // Unquoted dots split the id: provider `a` with an unknown field `b` (grok's inspect says so).
    expect(modelCredentialDecls(toml('[model_providers.a.b]', 'api_key = "k"'))).toEqual([]);
    // The link is a string or nothing: grok ignores any other type (inspect invalid-value).
    expect(modelCredentialDecls(toml('[model."m"]', 'model_provider = 1'))).toEqual([]);
    expect(modelCredentialDecls(toml('[model."m"]', 'model_provider = ["p"]'))).toEqual([]);
    expect(modelCredentialDecls(toml('[model."m"]', 'model_provider = { id = "p" }'))).toEqual([]);
  });

  // A51: a model with `model_provider = "<id>"` inherits that provider's api_key or env_key, and
  // grok sends it (contract §10 "[model_providers] 상속"). The reader records the provider table and
  // the link; liveModelCredentials decides what is inherited.
  it('records [model_providers.<id>] credentials and the model_provider link', () => {
    expect(modelCredentialDecls(toml(
      '[model_providers.gw]',
      'api_key = "k"',
      'env_key = ["UNSET", "GW_KEY"]',
      '',
      '[model."grok-4.6"]',
      'model_provider = "gw"',
    ))).toEqual([
      { provider: 'gw', via: 'api_key', nonEmpty: true },
      { provider: 'gw', via: 'env_key', names: ['UNSET', 'GW_KEY'] },
      { model: 'grok-4.6', via: 'model_provider', provider: 'gw' },
    ]);
  });

  it('reaches a provider table through every form grok accepted', () => {
    const want = [
      { provider: 'p', via: 'api_key', nonEmpty: true },
      { model: 'grok-4.6', via: 'model_provider', provider: 'p' },
    ];
    const forms = [
      toml('model_providers.p.api_key = "k"', 'model."grok-4.6".model_provider = "p"'),
      toml('model_providers = { p = { api_key = "k" } }', '[model."grok-4.6"]', 'model_provider = "p"'),
      toml('[model_providers]', 'p = { api_key = "k" }', '[model."grok-4.6"]', 'model_provider = "p"'),
      toml("[model_providers.'p']", "'api_key' = 'k'", "[model.'grok-4.6']", "model_provider = 'p'"),
    ];
    for (const f of forms) expect(modelCredentialDecls(f), f).toEqual(want);
    // The provider after the model: the same decls, in file order.
    expect(modelCredentialDecls(toml('[model."grok-4.6"]', 'model_provider = "p"', '[model_providers.p]', 'api_key = "k"')))
      .toEqual([want[1], want[0]]);
    // Quoted ids keep their dots and spaces.
    expect(modelCredentialDecls(toml('[model_providers."a.b c"]', 'api_key = "k"')))
      .toEqual([{ provider: 'a.b c', via: 'api_key', nonEmpty: true }]);
  });

  // grok 1.0.44/1.0.46 ignore every provider after `[[model_providers]]` ("all model providers
  // ignored" — measured); the header below it names a table inside the array's last element.
  it('reads no provider table under an array of tables', () => {
    expect(modelCredentialDecls(toml('[[model_providers]]', 'name = "x"', '[model_providers.p]', 'api_key = "k"'))).toEqual([]);
  });

  // MEASURED (contract §10, 1.0.44/1.0.46): grok rejects an env_key that is neither a string nor an
  // array of strings ("invalid-value") and then treats the model as having none — so a model with
  // `env_key = ["SET", 1]` inherits its provider's key instead of reading SET. The v0.2.39 reader kept
  // the strings and named SET. Such a value now yields no names.
  it('reads an env_key that grok rejects as no names at all', () => {
    for (const value of ['["K", 1]', '[["K"]]', '1', '{ k = "K" }', 'true']) {
      expect(modelCredentialDecls(toml('[model."m"]', `env_key = ${value}`)), value)
        .toEqual([{ model: 'm', via: 'env_key', names: [] }]);
      expect(modelCredentialDecls(toml('[model_providers.p]', `env_key = ${value}`)), value)
        .toEqual([{ provider: 'p', via: 'env_key', names: [] }]);
    }
  });

  it('reads credentials written as multi-line strings', () => {
    // The newline right after the opening delimiter is not part of the name.
    expect(modelCredentialDecls(toml('[model."m"]', 'env_key = """', 'K"""')))
      .toEqual([{ model: 'm', via: 'env_key', names: ['K'] }]);
    // Seven apostrophes: the delimiters plus ONE apostrophe of content, so a key is present.
    expect(modelCredentialDecls(toml('[model."m"]', "api_key = '''''''")))
      .toEqual([{ model: 'm', via: 'api_key', nonEmpty: true }]);
  });

  it('never reads structure out of string contents', () => {
    const text = toml(
      'notes = """',
      '[model."ghost"]',
      'api_key = "inside a multi-line basic string"',
      '"""',
      "raw = '''",
      '[model."ghost2"]',
      "api_key = 'inside a multi-line literal string'",
      "'''",
      `quoted = "a${BS}"b # still inside the string"`,
      '[model."real"]',
      'api_key = "x" # trailing comment',
    );
    expect(modelCredentialDecls(text)).toEqual([{ model: 'real', via: 'api_key', nonEmpty: true }]);
  });

  it('marks an empty or blank api_key as no credential', () => {
    expect(modelCredentialDecls(toml('[model."a"]', 'api_key = ""', '[model."b"]', 'api_key = "   "')))
      .toEqual([
        { model: 'a', via: 'api_key', nonEmpty: false },
        { model: 'b', via: 'api_key', nonEmpty: false },
      ]);
  });

  it('steps over every other kind of value without choking', () => {
    const text = toml(
      'when = 1979-05-27 07:32:00Z',
      'day = 1979-05-27',
      'pi = 3.14',
      'big = 1_000',
      'hex = 0xDEAD',
      'ok = true',
      'nested = [[1, 2], ["a", "b"], [{ x = 1 }]]',
      'spread = { a = [1,',
      '  2] }',
      'trailing = [1, 2, ]',
      '[model."m"]',
      'env_key = "K"',
    );
    expect(modelCredentialDecls(text)).toEqual([{ model: 'm', via: 'env_key', names: ['K'] }]);
  });

  it('accepts CRLF line endings and a UTF-8 byte order mark', () => {
    const text = String.fromCharCode(0xfeff) + ['[model."m"]', 'api_key = "x"', ''].join('\r\n');
    expect(modelCredentialDecls(text)).toEqual([{ model: 'm', via: 'api_key', nonEmpty: true }]);
  });

  it('decodes escapes in quoted keys', () => {
    // "a" + escaped u0062 is "ab".
    const text = toml(`[model."a${BS}u0062"]`, 'api_key = "x"');
    expect(modelCredentialDecls(text)).toEqual([{ model: 'ab', via: 'api_key', nonEmpty: true }]);
  });

  it('throws on a broken file, and the error never quotes the file', () => {
    const secret = 'xai-SECRET-VALUE-4242';
    const broken = [
      toml('[model."m"]', `api_key = "${secret}`),
      toml(`[model."${secret}"`),
      toml('[model."m"]', `api_key = [ "${secret}"`),
      toml('[model."m"]', 'api_key ='),
    ];
    for (const text of broken) {
      let message = '';
      try {
        modelCredentialDecls(text);
      } catch (e) {
        message = String(e);
      }
      expect(message, text).not.toBe('');
      expect(message, 'a parse error must not carry file content').not.toContain(secret);
    }
  });

  // AUDITED BY GROK 2026-09-24, two claims, one run each and nothing else in the prompt. Claim B, "some
  // VALID TOML makes this throw" (the user would be told the file could not be checked), came back
  // CLAIM_NOT_SHOWN with these eight documents traced by hand — pinned verbatim. Claim A, "some valid
  // TOML hides a model key from this reader", never came back inside the cap (four runs). Its proposed
  // hard cases were judged against an independent TOML 1.1 parser instead (smol-toml): the valid ones
  // all agree and are pinned below; the one invalid proposal (a non-ASCII bare key) is a file grok
  // refuses to load at all, so there is no run for a report to mislead about.
  it('scans the valid documents Grok traced for claim B without throwing', () => {
    const docs = [
      toml(`s = "a${BS}t${BS}n${BS}"${BS}${BS}${BS}u0041${BS}U00000042"`, `l = 'C:${BS}Users'`,
        "m = ''''That,' she said, 'is still pointless.''''"),
      toml(`str5 = """Here are three quotation marks: ""${BS}"."""`,
        'str7 = """"This," she said, "is just a pointless statement.""""',
        `str3 = """${BS}`, `       The quick brown ${BS}`, '       fox."""'),
      toml(`e = "${BS}e[${BS}x41"`),
      toml('i = +1_000', 'h = 0xdead_beef', 'o = 0o755', 'b = 0b1101', 'f = 6.626e-34', 's = +inf', 't = true'),
      toml('odt = 1979-05-27 07:32:00Z', 'odt2 = 1979-05-27T00:32:00.999999-07:00', 'lt = 07:32:00',
        'low = 1979-05-27t07:32:00Z', 'short = 1979-05-27 07:32Z'),
      toml('a = [', `  1, "x", 'y', true,`, '  { k = 1 }, [2], # c', ']'),
      toml('tbl = {', '    key = "a string",', '    moar-tbl = { key = 1, },', '}'),
      String.fromCodePoint(0xfeff) + toml('"" = "blank"', 'fruit . color = "yellow"',
        `[ j . "${String.fromCodePoint(0x29e)}" . 'l' ] # c`, '[[product]]', 'name = "Hammer"'),
    ];
    for (const d of docs) expect(() => modelCredentialDecls(d), d).not.toThrow();
  });

  it("reads Grok's proposed hard cases for claim A the way a reference TOML parser does", () => {
    const key = (model: string) => [{ model, via: 'api_key', nonEmpty: true }];
    const cases: [string, unknown[]][] = [
      [toml('[model]', 'api_key = "sk-123"'), []],
      [toml('[[model]]', 'api = "sk-123"'), []],
      [toml('[model."gpt-4"]', 'api_key = "sk-123"'), key('gpt-4')],
      [toml('model = {', '  gpt = { api_key = "sk-123", }', '}'), key('gpt')],
      [toml(`[model."grok${BS}u002d4"]`, 'api_key = "sk-123"'), key('grok-4')],
      [toml('[[model]]', '"gpt-4".api_key = "sk-123"'), []],
      [toml('model = { "gpt-4".api_key = "sk-123", }'), key('gpt-4')],
      [toml('[ model . "gpt 4" ]', 'api_key = "sk-123"'), key('gpt 4')],
      [toml('[model]', '"grok-4" = """', 'sk- 123', '"""'), []],
    ];
    for (const [text, want] of cases) expect(modelCredentialDecls(text), text).toEqual(want);
  });
});

describe('liveModelCredentials — only a credential grok would actually hold', () => {
  it('reports a non-empty api_key and skips an empty one', () => {
    expect(liveModelCredentials(
      [{ model: 'a', via: 'api_key', nonEmpty: true }, { model: 'b', via: 'api_key', nonEmpty: false }],
      {}, 'linux',
    )).toEqual([{ model: 'a', via: 'api_key' }]);
  });

  it('reports env_key only when a named variable is set and non-empty, naming the first such one', () => {
    const decls = [
      { model: 'unset', via: 'env_key' as const, names: ['NOPE'] },
      { model: 'blank', via: 'env_key' as const, names: ['BLANK'] },
      { model: 'second', via: 'env_key' as const, names: ['NOPE', 'SET_B', 'SET_C'] },
    ];
    expect(liveModelCredentials(decls, { BLANK: '', SET_B: 'v', SET_C: 'v' }, 'linux'))
      .toEqual([{ model: 'second', via: 'env_key', envVar: 'SET_B' }]);
  });

  it('lets api_key outrank env_key on one model, whichever comes first in the file', () => {
    const env = { K: 'v' };
    expect(liveModelCredentials([
      { model: 'm', via: 'env_key', names: ['K'] },
      { model: 'm', via: 'api_key', nonEmpty: true },
    ], env, 'linux')).toEqual([{ model: 'm', via: 'api_key' }]);
    // …and the other order (review: this half was untested).
    expect(liveModelCredentials([
      { model: 'm', via: 'api_key', nonEmpty: true },
      { model: 'm', via: 'env_key', names: ['K'] },
    ], env, 'linux')).toEqual([{ model: 'm', via: 'api_key' }]);
  });

  it('matches variable names case-insensitively on win32 only', () => {
    const decls = [{ model: 'm', via: 'env_key' as const, names: ['openai_api_key'] }];
    const env = { OPENAI_API_KEY: 'v' };
    expect(liveModelCredentials(decls, env, 'win32')).toEqual([{ model: 'm', via: 'env_key', envVar: 'openai_api_key' }]);
    expect(liveModelCredentials(decls, env, 'linux')).toEqual([]);
  });

  // Re-review of A51: two spellings of one variable with different blankness. Off win32 a name is its
  // exact spelling, judged on its own. On win32 a name counts as set when ANY spelling in its fold
  // class holds text — Node's spawn keeps one spelling per case class and Windows compares with its
  // own table, so picking one spelling (as before: the exact one, else the class's first) missed the
  // set one. `Foo`/`FOO` is a function input only — a win32 process.env cannot hold both; the
  // Kelvin-sign pair below is the case an installed server can meet.
  it('judges each spelling on its own off win32, and any spelling of the class on win32', () => {
    const decl = (names: string[]) => [{ model: 'm', via: 'env_key' as const, names }];
    const env = { Foo: '   ', FOO: 'v' };
    expect(liveModelCredentials(decl(['Foo', 'FOO']), env, 'linux'))
      .toEqual([{ model: 'm', via: 'env_key', envVar: 'FOO' }]);
    expect(liveModelCredentials(decl(['Foo']), env, 'linux')).toEqual([]);
    expect(liveModelCredentials(decl(['Foo']), env, 'win32'))
      .toEqual([{ model: 'm', via: 'env_key', envVar: 'Foo' }]);
    // …in either key order.
    expect(liveModelCredentials(decl(['Foo']), { FOO: 'v', Foo: '   ' }, 'win32'))
      .toEqual([{ model: 'm', via: 'env_key', envVar: 'Foo' }]);
    // The Kelvin sign folds to k here but not for Windows: a blank `X<Kelvin>` listed first must not
    // hide a set `XK` that Windows finds for `Xk`.
    const KELVIN = String.fromCharCode(0x212a);
    expect(liveModelCredentials(decl(['Xk']), { [`X${KELVIN}`]: ' ', XK: 'secret' }, 'win32'))
      .toEqual([{ model: 'm', via: 'env_key', envVar: 'Xk' }]);
  });

  // Adversarial review (A51), checked against ntdll's RtlUpcaseUnicodeChar: Windows folds a name one
  // character at a time, so GW_KEY + capital sigma finds GW_KEY + small sigma there. A whole-string
  // toLowerCase turned the final capital into the FINAL small sigma and missed it — silence about a
  // key grok would send if it looks the name up through the OS (measured with ASCII names only).
  it('folds win32 names one character at a time, as Windows does', () => {
    const SIGMA = String.fromCharCode(0x3a3);
    const sigma = String.fromCharCode(0x3c3);
    const decls = [{ model: 'm', via: 'env_key' as const, names: [`GW_KEY${SIGMA}`] }];
    expect(liveModelCredentials(decls, { [`GW_KEY${sigma}`]: 'v' }, 'win32'))
      .toEqual([{ model: 'm', via: 'env_key', envVar: `GW_KEY${SIGMA}` }]);
    // The mirror (third re-review): the capital is in the env's key, the small letter in the config.
    const mirror = [{ model: 'm', via: 'env_key' as const, names: [`GW_KEY${sigma}`] }];
    expect(liveModelCredentials(mirror, { [`GW_KEY${SIGMA}`]: 'v' }, 'win32'))
      .toEqual([{ model: 'm', via: 'env_key', envVar: `GW_KEY${sigma}` }]);
  });

  // Third re-review: the win32 fold index is built once per call. Rescanning the env for every name
  // passed every other test and took 22 s here for 50 models x 2000 names x 2000 variables.
  it('builds the win32 fold index once, however many names it answers', () => {
    const env = Object.fromEntries(Array.from({ length: 2000 }, (_, k) => [`ENV_VAR_${k}`, 'x']));
    const decls = Array.from({ length: 50 }, (_, m) => ({
      model: `m${m}`, via: 'env_key' as const, names: Array.from({ length: 2000 }, (_, k) => `unset_${m}_${k}`),
    }));
    const t0 = Date.now();
    expect(liveModelCredentials(decls, env, 'win32')).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(1000);
    // Post-merge review of v0.2.40: building the index once per MODEL passed the timing above (50
    // rebuilds are cheap) and took 7.6 s for 20,000 models of one name each. So count enumerations of
    // the env: one per call, however many models and providers ask.
    let scans = 0;
    const counted = new Proxy(env, { ownKeys: (target) => { scans++; return Reflect.ownKeys(target); } });
    const many = [
      { provider: 'p', via: 'env_key' as const, names: ['unset_p'] },
      ...Array.from({ length: 200 }, (_, m) => ({ model: `own${m}`, via: 'env_key' as const, names: [`unset_own${m}`] })),
      ...Array.from({ length: 200 }, (_, m) => ({ model: `link${m}`, via: 'model_provider' as const, provider: 'p' })),
    ];
    expect(liveModelCredentials(many, counted, 'win32')).toEqual([]);
    expect(scans).toBe(1);
  });

  // MEASURED (contract §10 "[model_providers] 상속", grok 1.0.44 and 1.0.46 agreed on every shape): a
  // value of only spaces is no value. v0.2.39 reported such a variable, while grok ran on the session.
  it('treats a variable holding only spaces as unset', () => {
    const decls = [{ model: 'm', via: 'env_key' as const, names: ['BLANK', 'SET'] }];
    expect(liveModelCredentials(decls, { BLANK: '   ', SET: 'v' }, 'linux'))
      .toEqual([{ model: 'm', via: 'env_key', envVar: 'SET' }]);
    expect(liveModelCredentials(decls, { BLANK: '   ' }, 'linux')).toEqual([]);
  });
});

// A51. Every row is a config.toml that grok 1.0.44 and 1.0.46 were run against (win32, synthetic
// session, fake keys on a loopback — contract §10 "[model_providers] 상속"), with the variables grok
// saw. `want` is what grok put on the main turn, as the plugin reports it: the model's own key, the
// key it inherited (`provider`), or nothing — no Authorization, or the session.
describe('liveModelCredentials — what a model inherits from [model_providers.<id>] (A51)', () => {
  const prov = (id: string, ...body: string[]) => toml(`[model_providers.${id}]`, ...body, '');
  const m46 = (...body: string[]) => toml('[model."grok-4.6"]', ...body, '');
  const REF = 'model_provider = "a51p"';
  const own = (via: 'api_key' | 'env_key', envVar?: string) =>
    [{ model: 'grok-4.6', via, ...(envVar ? { envVar } : {}) }];
  const inherited = (via: 'api_key' | 'env_key', envVar?: string, provider = 'a51p', model = 'grok-4.6') =>
    [{ model, via, ...(envVar ? { envVar } : {}), provider }];
  const S = { A51_S_VAR: 'xai-model-env-value' };
  const T = { A51_T_VAR: 'xai-provider-env-value' };
  const rows: { id: string; text: string; env?: Record<string, string>; want: unknown[] }[] = [
    // the provider alone
    { id: 'p-api', text: prov('a51p', 'api_key = "kP"') + m46(REF), want: inherited('api_key') },
    { id: 'p-env', text: prov('a51p', 'env_key = "A51_T_VAR"') + m46(REF), env: T, want: inherited('env_key', 'A51_T_VAR') },
    { id: 'p-env-arr', text: prov('a51p', 'env_key = ["A51_UNSET_VAR", "A51_T_VAR"]') + m46(REF), env: T, want: inherited('env_key', 'A51_T_VAR') },
    { id: 'p-env-case', text: prov('a51p', 'env_key = "a51_t_var"') + m46(REF), env: T, want: inherited('env_key', 'a51_t_var') },
    { id: 'p-env-unset', text: prov('a51p', 'env_key = "A51_UNSET_VAR"') + m46(REF), want: [] },
    { id: 'p-env-empty', text: prov('a51p', 'env_key = "A51_EMPTY_VAR"') + m46(REF), env: { A51_EMPTY_VAR: '' }, want: [] },
    { id: 'p-envws', text: prov('a51p', 'env_key = "A51_WS_VAR"') + m46(REF), env: { A51_WS_VAR: '   ' }, want: [] },
    { id: 'p-envemptyarr', text: prov('a51p', 'env_key = []') + m46(REF), want: [] },
    { id: 'p-api-empty', text: prov('a51p', 'api_key = ""') + m46(REF), want: [] },
    { id: 'p-api-ws', text: prov('a51p', 'api_key = "   "') + m46(REF), want: [] },
    { id: 'p-nocred', text: prov('a51p', 'api_backend = "chat_completions"') + m46(REF), want: [] },
    { id: 'p-apinonstring', text: prov('a51p', 'api_key = 1') + m46(REF), want: [] },
    { id: 'p-envnonstring', text: prov('a51p', 'env_key = 1') + m46(REF), want: [] },
    { id: 'p-envarr-mixed', text: prov('a51p', 'env_key = ["A51_T_VAR", 1]') + m46(REF), env: T, want: [] },
    { id: 'p-api-env', text: prov('a51p', 'api_key = "kP"', 'env_key = "A51_T_VAR"') + m46(REF), env: T, want: inherited('api_key') },
    { id: 'p-apiempty-env', text: prov('a51p', 'api_key = ""', 'env_key = "A51_T_VAR"') + m46(REF), env: T, want: inherited('env_key', 'A51_T_VAR') },
    { id: 'p-apiws-env', text: prov('a51p', 'api_key = "   "', 'env_key = "A51_T_VAR"') + m46(REF), env: T, want: inherited('env_key', 'A51_T_VAR') },
    { id: 'p-api-envunset', text: prov('a51p', 'api_key = "kP"', 'env_key = "A51_UNSET_VAR"') + m46(REF), want: inherited('api_key') },
    { id: 'p-envarr-ws-then-set', text: prov('a51p', 'env_key = ["A51_WS_VAR", "A51_T_VAR"]') + m46(REF), env: { A51_WS_VAR: '   ', ...T }, want: inherited('env_key', 'A51_T_VAR') },
    { id: 'p-ws-padded-key', text: prov('a51p', 'api_key = "  kP  "') + m46(REF), want: inherited('api_key') },
    { id: 'p-unknown-field', text: prov('a51p', 'api_key = "kP"', 'not_a_field = 1') + m46(REF), want: inherited('api_key') },
    // the link: exact, and only where it is written
    { id: 'p-undef', text: m46('model_provider = "a51nope"'), want: [] },
    { id: 'p-case', text: prov('a51p', 'api_key = "kP"') + m46('model_provider = "A51P"'), want: [] },
    { id: 'id-ws-ref', text: prov('a51p', 'api_key = "kP"') + m46('model_provider = " a51p "'), want: [] },
    { id: 'id-empty', text: prov('a51p', 'api_key = "kP"') + m46('model_provider = ""'), want: [] },
    { id: 'id-empty-defined', text: prov('""', 'api_key = "kP"') + m46('model_provider = ""'), want: inherited('api_key', undefined, '') },
    { id: 'p-unref', text: prov('a51p', 'api_key = "kP"') + m46('temperature = 0.5'), want: [] },
    { id: 'p-unref-notable', text: prov('a51p', 'api_key = "kP"'), want: [] },
    { id: 'p-builtin-xai', text: prov('xai', 'api_key = "kP"'), want: [] },
    { id: 'models-default-provider', text: prov('a51p', 'api_key = "kP"') + toml('[models]', REF), want: [] },
    { id: 'two-providers', text: prov('a51p', 'api_key = "kP"') + prov('a51q', 'api_key = "kB"') + m46('model_provider = "a51q"'), want: inherited('api_key', undefined, 'a51q') },
    { id: 'id-nonstring', text: prov('a51p', 'api_key = "kP"') + m46('model_provider = 1'), want: [] },
    { id: 'id-array', text: prov('a51p', 'api_key = "kP"') + m46('model_provider = ["a51p"]'), want: [] },
    // ids and TOML forms
    { id: 'id-dotted-unquoted', text: prov('a51.p', 'api_key = "kP"') + m46('model_provider = "a51.p"'), want: [] },
    { id: 'id-dotted-unquoted-ref-head', text: prov('a51.p', 'api_key = "kP"') + m46('model_provider = "a51"'), want: [] },
    { id: 'id-dotted-quoted', text: prov('"a51.p"', 'api_key = "kP"') + m46('model_provider = "a51.p"'), want: inherited('api_key', undefined, 'a51.p') },
    { id: 'id-space', text: prov('"a51 p"', 'api_key = "kP"') + m46('model_provider = "a51 p"'), want: inherited('api_key', undefined, 'a51 p') },
    { id: 'id-reserved-prefix', text: prov('"model_provider:a51p"', 'api_key = "kP"') + m46('model_provider = "model_provider:a51p"'), want: inherited('api_key', undefined, 'model_provider:a51p') },
    { id: 'id-root-dotted', text: toml('model_providers.a51p.api_key = "kP"', 'model."grok-4.6".model_provider = "a51p"'), want: inherited('api_key') },
    { id: 'id-inline', text: toml('model_providers = { a51p = { api_key = "kP" } }', '') + m46(REF), want: inherited('api_key') },
    { id: 'id-inline-under', text: toml('[model_providers]', 'a51p = { api_key = "kP" }', '') + m46(REF), want: inherited('api_key') },
    { id: 'id-provider-after', text: m46(REF) + prov('a51p', 'api_key = "kP"'), want: inherited('api_key') },
    { id: 'id-aot', text: toml('[[model_providers]]', 'name = "x"', '') + prov('a51p', 'api_key = "kP"') + m46(REF), want: [] },
    { id: 'id-literal', text: toml("[model_providers.'a51p']", "'api_key' = 'kP'", '', "[model.'grok-4.6']", "model_provider = 'a51p'"), want: inherited('api_key') },
    { id: 'id-model-unquoted', text: prov('a51p', 'api_key = "kP"') + toml('[model.grok-4.6]', REF), want: [] },
    // the model's own fields beside the provider's
    { id: 'mx-api-papi', text: prov('a51p', 'api_key = "kP"') + m46('api_key = "kA"', REF), want: own('api_key') },
    { id: 'mx-api-penv', text: prov('a51p', 'env_key = "A51_T_VAR"') + m46('api_key = "kA"', REF), env: T, want: own('api_key') },
    { id: 'mx-api-pundef', text: m46('api_key = "kA"', 'model_provider = "a51nope"'), want: own('api_key') },
    { id: 'mx-env-papi', text: prov('a51p', 'api_key = "kP"') + m46('env_key = "A51_S_VAR"', REF), env: S, want: own('env_key', 'A51_S_VAR') },
    { id: 'mx-env-penv', text: prov('a51p', 'env_key = "A51_T_VAR"') + m46('env_key = "A51_S_VAR"', REF), env: { ...S, ...T }, want: own('env_key', 'A51_S_VAR') },
    { id: 'mx-env-pnocred', text: prov('a51p', 'api_backend = "chat_completions"') + m46('env_key = "A51_S_VAR"', REF), env: S, want: own('env_key', 'A51_S_VAR') },
    { id: 'mx-env-pundef', text: m46('env_key = "A51_S_VAR"', 'model_provider = "a51nope"'), env: S, want: own('env_key', 'A51_S_VAR') },
    { id: 'mx-apiempty-env-papi', text: prov('a51p', 'api_key = "kP"') + m46('api_key = ""', 'env_key = "A51_S_VAR"', REF), env: S, want: own('env_key', 'A51_S_VAR') },
    { id: 'mx-apinonstring-env-papi', text: prov('a51p', 'api_key = "kP"') + m46('api_key = 1', 'env_key = "A51_S_VAR"', REF), env: S, want: own('env_key', 'A51_S_VAR') },
    { id: 'mx-ref-invalid-provider-envok', text: prov('a51p', 'api_key = 1') + m46('env_key = "A51_S_VAR"', REF), env: S, want: own('env_key', 'A51_S_VAR') },
    // the model's own env_key names a variable: only those count, set or not
    { id: 'mx-envunset-papi', text: prov('a51p', 'api_key = "kP"') + m46('env_key = "A51_UNSET_VAR"', REF), want: [] },
    { id: 'mx-envempty-papi', text: prov('a51p', 'api_key = "kP"') + m46('env_key = "A51_EMPTY_VAR"', REF), env: { A51_EMPTY_VAR: '' }, want: [] },
    { id: 'mx-envws-papi', text: prov('a51p', 'api_key = "kP"') + m46('env_key = "A51_WS_VAR"', REF), env: { A51_WS_VAR: '   ' }, want: [] },
    { id: 'mx-envwsname-papi', text: prov('a51p', 'api_key = "kP"') + m46('env_key = "   "', REF), want: [] },
    { id: 'mx-envunset-penv', text: prov('a51p', 'env_key = "A51_T_VAR"') + m46('env_key = "A51_UNSET_VAR"', REF), env: T, want: [] },
    { id: 'mx-envunset-pundef', text: m46('env_key = "A51_UNSET_VAR"', 'model_provider = "a51nope"'), want: [] },
    { id: 'mx-envunset-penvunset', text: prov('a51p', 'env_key = "A51_UNSET_VAR"') + m46('env_key = "A51_UNSET_VAR"', REF), want: [] },
    { id: 'mx-envxai-papi', text: prov('a51p', 'api_key = "kP"') + m46('env_key = "XAI_API_KEY"', REF), want: [] },
    { id: 'mx-envarr-emptyname-unset-papi', text: prov('a51p', 'api_key = "kP"') + m46('env_key = ["", "A51_UNSET_VAR"]', REF), want: [] },
    // …and a field grok treats as absent leaves the provider's key to inherit
    { id: 'mx-apiempty-papi', text: prov('a51p', 'api_key = "kP"') + m46('api_key = ""', REF), want: inherited('api_key') },
    { id: 'mx-apiws-papi', text: prov('a51p', 'api_key = "kP"') + m46('api_key = "   "', REF), want: inherited('api_key') },
    { id: 'mx-apinonstring-papi', text: prov('a51p', 'api_key = "kP"') + m46('api_key = 1', REF), want: inherited('api_key') },
    { id: 'mx-apiempty-penv', text: prov('a51p', 'env_key = "A51_T_VAR"') + m46('api_key = ""', REF), env: T, want: inherited('env_key', 'A51_T_VAR') },
    { id: 'mx-apiempty-pnocred', text: prov('a51p', 'api_backend = "chat_completions"') + m46('api_key = ""', REF), want: [] },
    { id: 'mx-envemptyname-papi', text: prov('a51p', 'api_key = "kP"') + m46('env_key = ""', REF), want: inherited('api_key') },
    { id: 'mx-envemptyarr-papi', text: prov('a51p', 'api_key = "kP"') + m46('env_key = []', REF), want: inherited('api_key') },
    { id: 'mx-envarr-emptyname-papi', text: prov('a51p', 'api_key = "kP"') + m46('env_key = [""]', REF), want: inherited('api_key') },
    { id: 'mx-envnonstring-papi', text: prov('a51p', 'api_key = "kP"') + m46('env_key = 1', REF), want: inherited('api_key') },
    { id: 'mx-envarr-mixed-papi', text: prov('a51p', 'api_key = "kP"') + m46('env_key = ["A51_S_VAR", 1]', REF), env: S, want: inherited('api_key') },
    { id: 'mx-envarr-nested-papi', text: prov('a51p', 'api_key = "kP"') + m46('env_key = [["A51_S_VAR"]]', REF), env: S, want: inherited('api_key') },
    // a model with no provider: v0.2.39 reported these two, grok ran on the session
    { id: 'm-envws', text: m46('env_key = "A51_WS_VAR"'), env: { A51_WS_VAR: '   ' }, want: [] },
    { id: 'm-envarr-mixed', text: m46('env_key = ["A51_S_VAR", 1]'), env: S, want: [] },
    { id: 'm-apiws', text: m46('api_key = "   "'), want: [] },
    { id: 'm-apiws-env', text: m46('api_key = "   "', 'env_key = "A51_S_VAR"'), env: S, want: own('env_key', 'A51_S_VAR') },
    { id: 'm-envarr-ws-then-set', text: m46('env_key = ["A51_WS_VAR", "A51_S_VAR"]'), env: { A51_WS_VAR: '   ', ...S }, want: own('env_key', 'A51_S_VAR') },
    // more than one model, and a model grok has no catalog entry for
    { id: 'multi-47', text: prov('a51p', 'api_key = "kP"') + m46(REF) + toml('[model."grok-4.7"]', REF), want: [...inherited('api_key'), ...inherited('api_key', undefined, 'a51p', 'grok-4.7')] },
    { id: 'custom-model', text: prov('a51p', 'api_key = "kP"') + toml('[model."a51-custom"]', 'model = "a51-custom-model"', REF), want: inherited('api_key', undefined, 'a51p', 'a51-custom') },
  ];

  it.each(rows)('$id', ({ text, env, want }) => {
    expect(liveModelCredentials(modelCredentialDecls(text), env ?? {}, 'win32')).toEqual(want);
  });

  // Not measured off win32: grok's variable lookup there is the OS's, so this follows the model rule.
  it('matches a provider variable name case-insensitively on win32 only', () => {
    const text = prov('a51p', 'env_key = "a51_t_var"') + m46(REF);
    expect(liveModelCredentials(modelCredentialDecls(text), T, 'linux')).toEqual([]);
  });

  // KNOWN OVER-REPORT, kept on purpose. grok drops a whole provider table when any field fails to
  // parse ("provider skipped, inheriting models resolve with defaults" — measured with api_key = 1
  // and max_request_bytes = "big"), and its models then send no config.toml key. The reader does not validate
  // fields it only steps over, so it still reports the key that is written — a warning about a key
  // that is never sent, never silence about one that is.
  it('still reports a provider grok skips for a field it cannot parse', () => {
    expect(liveModelCredentials(modelCredentialDecls(prov('a51p', 'api_key = 1', 'env_key = "A51_T_VAR"') + m46(REF)), T, 'win32'))
      .toEqual(inherited('env_key', 'A51_T_VAR'));
    expect(liveModelCredentials(modelCredentialDecls(prov('a51p', 'api_key = "kP"', 'max_request_bytes = "big"') + m46(REF)), {}, 'win32'))
      .toEqual(inherited('api_key'));
  });

  // FOUND IN PRE-MERGE REVIEW (A51): "is this value blank?" was asked per reference, and trimming a
  // long blank value each time stalled — 260k references to one blank 32 KiB value took 7.2 s before
  // every spawn. It is judged once per variable the env really has, and win32 case variants of one
  // name (any number of them) share that judgement.
  it('judges a long blank value once, however many names point at it', () => {
    const blank = ' '.repeat(32_767);
    const same = Array.from({ length: 100_000 }, () => 'BLANK_51');
    const name = 'ABCDEFGHIJKLMNOPQ';
    // Distinct spellings of one 17-letter name: bit i of k lowers letter i.
    const variants = Array.from({ length: 100_000 }, (_, k) =>
      [...name].map((c, i) => ((k >> i) & 1 ? c.toLowerCase() : c)).join(''));
    const t0 = Date.now();
    expect(liveModelCredentials([{ model: 'm', via: 'env_key', names: same }], { BLANK_51: blank }, 'linux')).toEqual([]);
    expect(liveModelCredentials([
      { provider: 'p', via: 'env_key', names: variants },
      { model: 'm', via: 'model_provider', provider: 'p' },
    ], { [name]: blank }, 'win32')).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  // FOUND BY the plan's mutation list ("모델마다 재탐색"): resolving the provider again for every
  // model, or scanning every declaration per model, is quadratic — and this runs before every spawn.
  it('stays linear in models and providers', () => {
    const n = 40_000;
    const decls: CredentialDecl[] = [];
    for (let k = 0; k < n; k++) decls.push({ provider: `p${k}`, via: 'env_key', names: ['UNSET_A', 'UNSET_B'] });
    for (let k = 0; k < n; k++) decls.push({ model: `m${k}`, via: 'model_provider', provider: `p${n - 1 - k}` });
    decls.push({ provider: 'shared', via: 'env_key', names: Array.from({ length: 5_000 }, (_, k) => `UNSET_${k}`) });
    for (let k = 0; k < n; k++) decls.push({ model: `s${k}`, via: 'model_provider', provider: 'shared' });
    const t0 = Date.now();
    expect(liveModelCredentials(decls, {}, 'win32')).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('configBillingCaveat — reported, never thrown, never leaked', () => {
  const home = join('/fake', 'grok-home');
  const configPath = join(home, 'config.toml');
  const deps = (text: string | Error, platform: NodeJS.Platform = 'linux'): BillingCaveatDeps => ({
    readFile: (p) => {
      if (p !== configPath) throw new Error(`read the wrong file: ${p}`);
      if (text instanceof Error) throw text;
      return text;
    },
    platform,
  });
  const env = (extra: Record<string, string> = {}) => ({ GROK_HOME: home, ...extra });

  it('says nothing in api mode, and does not even read the file', () => {
    const reads: string[] = [];
    const caveat = configBillingCaveat('api', env(), {
      readFile: (p) => { reads.push(p); return toml('[model."m"]', 'api_key = "x"'); },
      platform: 'linux',
    });
    expect(caveat).toBeUndefined();
    expect(reads).toEqual([]);
  });

  it('reads config.toml under GROK_HOME and reports an inline key without its value', () => {
    const secret = 'xai-INLINE-SECRET-777';
    const caveat = configBillingCaveat('subscription', env(), deps(toml('[model."grok-4.7"]', `api_key = "${secret}"`)));
    expect(caveat).toMatchObject({
      reason: 'config_model_keys',
      configPath,
      models: [{ model: 'grok-4.7', via: 'api_key' }],
    });
    expect(caveat?.message).toContain('grok-4.7');
    expect(JSON.stringify(caveat)).not.toContain(secret);
  });

  it('reports an env_key by the NAME of the variable, never its value', () => {
    const value = 'sk-ENV-SECRET-999';
    const caveat = configBillingCaveat(
      'subscription',
      env({ OPENAI_API_KEY: value }),
      deps(toml('[model."gpt-4o"]', 'env_key = "OPENAI_API_KEY"')),
    );
    expect(caveat).toMatchObject({
      reason: 'config_model_keys',
      models: [{ model: 'gpt-4o', via: 'env_key', envVar: 'OPENAI_API_KEY' }],
    });
    expect(caveat?.message).toContain('OPENAI_API_KEY');
    expect(JSON.stringify(caveat)).not.toContain(value);
  });

  // Subscription mode strips these two before grok ever starts (env.ts buildGrokEnv), so a model
  // that points at them has nothing to send. Warning about it would contradict the strip.
  it('does not report env_key pointing at a variable the subscription strip removes', () => {
    for (const [name, platform] of [['XAI_API_KEY', 'linux'], ['GROK_CODE_XAI_API_KEY', 'linux'], ['xai_api_key', 'win32']] as const) {
      const caveat = configBillingCaveat(
        'subscription',
        env({ XAI_API_KEY: 'v', GROK_CODE_XAI_API_KEY: 'v' }),
        deps(toml('[model."grok-4.7"]', `env_key = "${name}"`), platform),
      );
      expect(caveat, `${name} on ${platform}`).toBeUndefined();
    }
  });

  // A51: the exact config.toml the shipped v0.2.39 bundle was reproduced with (status: no caveat;
  // delegate: billing "subscription", no caveat, while the provider's key rode the main turn).
  it('reports a model that inherits a [model_providers] key, naming the provider and never the value', () => {
    const secret = 'xai-PROVIDER-SECRET-51';
    const value = 'sk-PROVIDER-ENV-VALUE-51';
    const caveat = configBillingCaveat('subscription', env({ GW_KEY: value }), deps(toml(
      '[model_providers.a51p]', `api_key = "${secret}"`, '',
      '[model_providers.gw]', 'env_key = "GW_KEY"', '',
      '[model."grok-4.6"]', 'model_provider = "a51p"', '',
      '[model."claude-gw"]', 'model_provider = "gw"', '',
      '[model."grok-4.7"]', 'api_key = "own"',
    )));
    if (caveat?.reason !== 'config_model_keys') throw new Error(`expected config_model_keys, got ${caveat?.reason}`);
    // The response keeps its v0.2.33 shape: no provider field (docs/04).
    expect(caveat.models).toEqual([
      { model: 'grok-4.6', via: 'api_key' },
      { model: 'claude-gw', via: 'env_key', envVar: 'GW_KEY' },
      { model: 'grok-4.7', via: 'api_key' },
    ]);
    expect(caveat.message).toContain('grok-4.6 ([model_providers."a51p"]의 api_key)');
    expect(caveat.message).toContain('claude-gw ([model_providers."gw"]의 env_key → GW_KEY)');
    expect(caveat.message).toContain('grok-4.7 (api_key)');
    // The remedy is the model's model_provider line, not the provider's key: deleting only the key
    // brings the session back on grok's default endpoint (debug log), while a provider with its own
    // base_url leaves the model marked "fail-closed" (its request headers were not measured — contract
    // §10). The message promises neither.
    expect(caveat.message).toContain('물려받은 키는 model_provider를 지우세요');
    expect(caveat.message).not.toContain('자격증명 없이');
    expect(JSON.stringify(caveat)).not.toContain(secret);
    expect(JSON.stringify(caveat)).not.toContain(value);
  });

  it('keeps the v0.2.33 message when no model inherits', () => {
    const caveat = configBillingCaveat('subscription', env(), deps(toml('[model."grok-4.7"]', 'api_key = "k"')));
    expect(caveat?.message).toBe(
      `grok 설정(${configPath})에 자체 자격증명을 가진 모델이 있습니다: grok-4.7 (api_key). `
      + 'grok 문서의 자격증명 순서에서 모델 자체 자격증명은 구독 세션보다 앞서므로, 그 모델로 도는 위임은 '
      + 'billing이 "subscription"이어도 구독이 아니라 그 키로(종량제) 청구될 수 있습니다. 실행은 막지 않습니다 — '
      + '의도한 설정이 아니면 해당 [model."…"] 절에서 api_key·env_key를 지우세요.',
    );
  });

  // The plan's "not reported" list: a provider no model points at, a variable that is not set, and a
  // variable the subscription strip removes before grok starts (judged on buildGrokEnv's env).
  it('does not report an unreferenced provider, an unset variable, or a stripped one', () => {
    const cases: [string, string, Record<string, string>][] = [
      ['unreferenced', toml('[model_providers.p]', 'api_key = "k"', '[model."m"]', 'temperature = 0.5'), {}],
      ['unset', toml('[model_providers.p]', 'env_key = "NOT_SET_51"', '[model."m"]', 'model_provider = "p"'), {}],
      ['stripped', toml('[model_providers.p]', 'env_key = "XAI_API_KEY"', '[model."m"]', 'model_provider = "p"'), { XAI_API_KEY: 'v' }],
      ['stripped alias', toml('[model_providers.p]', 'env_key = ["GROK_CODE_XAI_API_KEY"]', '[model."m"]', 'model_provider = "p"'), { GROK_CODE_XAI_API_KEY: 'v' }],
    ];
    for (const [label, text, extra] of cases) {
      expect(configBillingCaveat('subscription', env(extra), deps(text)), label).toBeUndefined();
    }
  });

  // Re-review (A51): computing "does any model inherit" from the models SHOWN would drop the
  // inheritance remedy when the inheriting model is past CAVEAT_MODEL_LIMIT. Every model counts.
  it('explains inheritance even when the inheriting model is past the listed limit', () => {
    const own = Array.from({ length: CAVEAT_MODEL_LIMIT }, (_, k) => [`[model."own${k}"]`, 'api_key = "k"']).flat();
    const caveat = configBillingCaveat('subscription', env(), deps(toml(
      ...own, '[model_providers.gw]', 'api_key = "k"', '[model."late"]', 'model_provider = "gw"',
    )));
    if (caveat?.reason !== 'config_model_keys') throw new Error(`expected config_model_keys, got ${caveat?.reason}`);
    expect(caveat.modelsOmitted).toBe(1);
    expect(caveat.message).toContain('물려받은 키는 model_provider를 지우세요');
  });

  // Re-review (A51): no test made an inherited label cut a long MODEL id.
  it('cuts a long model id in an inherited label', () => {
    const longId = 'm'.repeat(CAVEAT_NAME_LIMIT + 50);
    const caveat = configBillingCaveat('subscription', env(), deps(toml(
      '[model_providers.gw]', 'api_key = "k"', `[model."${longId}"]`, 'model_provider = "gw"',
    )));
    expect(caveat?.message).toContain(`${longId.slice(0, CAVEAT_NAME_LIMIT)}… ([model_providers."gw"]의 api_key)`);
    expect(caveat?.message).not.toContain(longId);
  });

  // The strip and the own-env_key rule together (measured shape mx-envxai-papi, contract §10): a model
  // whose own env_key names XAI_API_KEY keeps its credential slot, and subscription mode removes that
  // variable before grok starts — so grok uses neither it nor the linked provider's key.
  it('does not let a model whose own env_key names a stripped variable inherit', () => {
    const caveat = configBillingCaveat('subscription', env({ XAI_API_KEY: 'v' }), deps(toml(
      '[model_providers.gw]', 'api_key = "k"', '[model."m"]', 'env_key = "XAI_API_KEY"', 'model_provider = "gw"',
    )));
    expect(caveat).toBeUndefined();
  });

  it('cuts a long provider id in the message', () => {
    const longId = 'p'.repeat(CAVEAT_NAME_LIMIT + 50);
    const caveat = configBillingCaveat('subscription', env(), deps(toml(
      `[model_providers."${longId}"]`, 'api_key = "k"', '[model."m"]', `model_provider = "${longId}"`,
    )));
    expect(caveat?.message).toContain(`[model_providers."${longId.slice(0, CAVEAT_NAME_LIMIT)}…"]`);
    expect(caveat?.message).not.toContain(longId);
  });

  // A35: grok resolves a relative GROK_HOME against the folder it runs in (measured, 1.0.41).
  it('reads <task folder>/<relative GROK_HOME>/config.toml when given the task folder', () => {
    const task = join(homedir(), 'a35-task-folder');
    const expected = join(task, 'rel-home', 'config.toml');
    const reads: string[] = [];
    const caveat = configBillingCaveat('subscription', { GROK_HOME: 'rel-home' }, {
      readFile: (p) => { reads.push(p); return toml('[model."m"]', 'api_key = "x"'); },
      platform: 'linux',
    }, task);
    expect(reads).toEqual([expected]);
    expect(caveat?.configPath).toBe(expected);
  });

  it('says nothing when there is no config.toml — grok runs on its defaults', () => {
    expect(configBillingCaveat('subscription', env(), deps(errno('ENOENT')))).toBeUndefined();
  });

  it('says nothing when the file holds no live per-model credential', () => {
    expect(configBillingCaveat('subscription', env(), deps(toml('[models]', 'default = "grok-4.7"')))).toBeUndefined();
    expect(configBillingCaveat('subscription', env(), deps(toml('[model."m"]', 'env_key = "UNSET_VAR"')))).toBeUndefined();
  });

  // "Could not ask" is not "nothing there" — the repo's rule for every probe (CLAUDE.md).
  it('reports an unreadable or unparsable file as unchecked, not as clean', () => {
    const secret = 'xai-HALF-WRITTEN-555';
    const cases: [string, string | Error][] = [
      ['EACCES', errno('EACCES')],
      ['EISDIR', errno('EISDIR')],
      ['parse error', toml('[model."m"]', `api_key = "${secret}`)],
    ];
    for (const [label, input] of cases) {
      const caveat = configBillingCaveat('subscription', env(), deps(input));
      expect(caveat, label).toMatchObject({ reason: 'config_unreadable', configPath });
      expect(JSON.stringify(caveat), label).not.toContain(secret);
    }
  });

  // The caveat rides on every status and delegate/plan/verify result. Review built a config with
  // 50k keyed models and got a 4.3M-character status; the list is now capped and the rest counted.
  it('names at most CAVEAT_MODEL_LIMIT models and counts the rest instead of dropping them', () => {
    const tables = (n: number) => toml(...Array.from({ length: n }, (_, k) => [`[model."m${k}"]`, 'api_key = "x"']).flat());
    const over = configBillingCaveat('subscription', env(), deps(tables(CAVEAT_MODEL_LIMIT + 5)));
    expect(over).toMatchObject({ reason: 'config_model_keys', modelsOmitted: 5 });
    if (over?.reason !== 'config_model_keys') throw new Error('unreachable');
    expect(over.models).toHaveLength(CAVEAT_MODEL_LIMIT);
    expect(over.message).toContain('외 5개');
    expect(over.message).not.toContain(`m${CAVEAT_MODEL_LIMIT} (`);
    const exact = configBillingCaveat('subscription', env(), deps(tables(CAVEAT_MODEL_LIMIT)));
    expect(exact).not.toHaveProperty('modelsOmitted');
  });

  // Re-review: the count cap alone let 20 long ids make a 2M-character caveat on every result.
  it('cuts a long model id or variable name, and says it did', () => {
    const longId = 'x'.repeat(CAVEAT_NAME_LIMIT + 100);
    const longVar = 'V'.repeat(CAVEAT_NAME_LIMIT + 100);
    const caveat = configBillingCaveat(
      'subscription',
      env({ [longVar]: 'set' }),
      deps(toml(`[model."${longId}"]`, 'api_key = "x"', '[model."gw"]', `env_key = "${longVar}"`)),
    );
    if (caveat?.reason !== 'config_model_keys') throw new Error(`expected config_model_keys, got ${caveat?.reason}`);
    expect(caveat.models[0].model).toBe(`${longId.slice(0, CAVEAT_NAME_LIMIT)}…`);
    expect(caveat.models[1].envVar).toBe(`${longVar.slice(0, CAVEAT_NAME_LIMIT)}…`);
    expect(caveat.message).not.toContain(longId);
    expect(caveat.message).not.toContain(longVar);
  });

  // Final review: the cut counted UTF-16 units, so an emoji across the limit left half a surrogate
  // pair before the "…". The pair is now kept whole or dropped whole.
  it('never cuts a character in half', () => {
    const emoji = String.fromCodePoint(0x1f600);
    const id = 'x'.repeat(CAVEAT_NAME_LIMIT - 1) + emoji + 'tail';
    const caveat = configBillingCaveat('subscription', env(), deps(toml(`[model."${id}"]`, 'api_key = "x"')));
    if (caveat?.reason !== 'config_model_keys') throw new Error(`expected config_model_keys, got ${caveat?.reason}`);
    expect(caveat.models[0].model).toBe(`${'x'.repeat(CAVEAT_NAME_LIMIT - 1)}…`);
  });
});

// FOUND IN RE-REVIEW: the array-of-tables fix compared every header with every earlier `[[…]]` path
// (27 s for 96k headers in a valid 1 MB file), and every key copied the whole table path (50 s for
// a 200k-part header then 59k keys). This read runs before every spawn, so time is the property.
// Measured before settling the sizes: at 30k array headers the previous reader took 1,969 ms and
// this one 19 ms — too close to a 1 s bound to trust on a fast CI machine — so the arrays case uses
// 60k (the old cost is quadratic, about 8 s). The deep case failed at 2.9 s against the same bound.
describe('modelCredentialDecls stays fast on hostile but valid files', () => {
  // Built with join, not by spreading into toml(...): 60k arguments sit at half of V8's limit, and a
  // wider size would throw RangeError in setup instead of failing the timing (final review).
  it('many arrays of tables', () => {
    const text = [...Array.from({ length: 60_000 }, (_, k) => `[[t${k}]]`), '[model."m"]', 'api_key = "x"'].join('\n');
    const t0 = Date.now();
    expect(modelCredentialDecls(text)).toEqual([{ model: 'm', via: 'api_key', nonEmpty: true }]);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('a very deep header followed by many keys', () => {
    const header = `[${Array.from({ length: 30_000 }, (_, k) => `p${k}`).join('.')}]`;
    const text = [header, ...Array.from({ length: 30_000 }, (_, k) => `k${k} = 1`), '[model."m"]', 'api_key = "x"'].join('\n');
    const t0 = Date.now();
    expect(modelCredentialDecls(text)).toEqual([{ model: 'm', via: 'api_key', nonEmpty: true }]);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('readRegularFileCapped — the real reader never blocks and never reads past its cap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'grok-caveat-read-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const onWin32 = process.platform === 'win32';
  // A writer that opens `fifo` one second from now and copies `from` into it. If a regression goes
  // back to plain reading, the read waits for this writer and RETURNS the content — so the test
  // fails in about a second instead of hanging the run (the CI jobs set no timeout). With the fix
  // the writer never meets a reader. It runs in its own process group so the kill below takes its
  // `sleep` child too (re-review: killing only `sh` orphaned it for a second).
  const delayedWriter = (from: string, fifo: string) =>
    spawn('sh', ['-c', 'sleep 1; cat "$1" > "$2"', 'sh', from, fifo], { stdio: 'ignore', detached: true });
  const killGroup = (pid: number | undefined) => {
    try {
      if (pid !== undefined) process.kill(-pid, 'SIGKILL');
    } catch {
      // already gone
    }
  };

  it('reads a regular file', () => {
    const p = join(dir, 'plain.toml');
    writeFileSync(p, '[model."m"]\napi_key = "x"\n');
    expect(readRegularFileCapped(p, 1024)).toContain('[model."m"]');
  });

  it('keeps ENOENT for a missing file, so "no config" stays distinguishable from "unreadable"', () => {
    let code: string | undefined;
    try {
      readRegularFileCapped(join(dir, 'missing.toml'), 1024);
    } catch (e) {
      code = (e as NodeJS.ErrnoException).code;
    }
    expect(code).toBe('ENOENT');
  });

  it('refuses a file over the limit, and a directory', () => {
    const big = join(dir, 'big.toml');
    writeFileSync(big, 'x'.repeat(20));
    expect(() => readRegularFileCapped(big, 10)).toThrow(/limit/);
    const sub = join(dir, 'a-directory.toml');
    mkdirSync(sub);
    expect(() => readRegularFileCapped(sub, 1024)).toThrow(/not a regular file/);
  });

  // FOUND IN PRE-MERGE REVIEW (reproduced on Linux): the first version read with readFileSync, and
  // a FIFO with no writer never returned — the whole server stopped answering, route included.
  it.skipIf(onWin32)('refuses a FIFO without opening it', () => {
    const fifo = join(dir, 'fifo.toml');
    const from = join(dir, 'fifo-source.toml');
    writeFileSync(from, 'x');
    expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
    const writer = delayedWriter(from, fifo);
    try {
      const t0 = Date.now();
      expect(() => readRegularFileCapped(fifo, 1024)).toThrow(/not a regular file/);
      expect(Date.now() - t0).toBeLessThan(500);
    } finally {
      killGroup(writer.pid);
    }
  });

  // /dev/null rather than review's /dev/zero: a regressed reader would stream /dev/zero forever,
  // while /dev/null ends at once — so a regression shows up as a plain failure.
  it.skipIf(onWin32)('refuses a link to a device', () => {
    const link = join(dir, 'device.toml');
    symlinkSync('/dev/null', link);
    expect(() => readRegularFileCapped(link, 1024)).toThrow(/not a regular file/);
  });

  // The tests above call the function directly. These go through configBillingCaveat's DEFAULT
  // deps — re-review found nothing pinned that the default uses the capped reader: switching it back
  // to readFileSync left every test green while a FIFO config.toml hung the real call.
  it('turns a config.toml that is not a regular file into config_unreadable end to end', () => {
    const home = join(dir, 'home-with-dir');
    mkdirSync(join(home, 'config.toml'), { recursive: true });
    expect(configBillingCaveat('subscription', { GROK_HOME: home })).toMatchObject({ reason: 'config_unreadable' });
  });

  it('does not read an over-limit config.toml end to end, even one that names a model key', () => {
    const home = join(dir, 'home-too-big');
    mkdirSync(home);
    // Valid TOML with a key: a plain read would report config_model_keys.
    writeFileSync(join(home, 'config.toml'), toml('[model."m"]', 'api_key = "x"', `pad = "${'x'.repeat(1024 * 1024)}"`));
    expect(configBillingCaveat('subscription', { GROK_HOME: home })).toMatchObject({ reason: 'config_unreadable' });
  });

  it.skipIf(onWin32)('does not open a FIFO config.toml end to end', () => {
    const home = join(dir, 'home-fifo');
    mkdirSync(home);
    const fifo = join(home, 'config.toml');
    const from = join(dir, 'fifo-keyed-source.toml');
    // What the delayed writer delivers is valid TOML with a key, so a plain read that waited for it
    // would come back config_model_keys, not config_unreadable.
    writeFileSync(from, toml('[model."m"]', 'api_key = "x"', ''));
    expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
    const writer = delayedWriter(from, fifo);
    try {
      const t0 = Date.now();
      expect(configBillingCaveat('subscription', { GROK_HOME: home })).toMatchObject({ reason: 'config_unreadable' });
      expect(Date.now() - t0).toBeLessThan(500);
    } finally {
      killGroup(writer.pid);
    }
  });
});
