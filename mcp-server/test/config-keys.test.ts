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
  // three parts", left every earlier test green.
  it('counts model / <id> / field only — not another root, and not deeper', () => {
    expect(modelCredentialDecls(toml('[model_providers."openai"]', 'env_key = "OPENAI_API_KEY"'))).toEqual([]);
    expect(modelCredentialDecls(toml('[providers."x"]', 'api_key = "k"'))).toEqual([]);
    expect(modelCredentialDecls(toml('[model."m".api_key]', 'value = "x"'))).toEqual([]);
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
