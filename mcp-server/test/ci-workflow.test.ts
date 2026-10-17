/**
 * SonarCloud githubactions:S6505 (analysis of 2026-09-23): `npm ci` without `--ignore-scripts` runs every dependency's
 * install script in CI — today esbuild's (fsevents has one too, but installs only on macOS), any future one silently.
 * Measured on 2026-10-17 before adopting the flag: on win32 and in a node:22 Linux shallow clone, `npm ci
 * --ignore-scripts` built bundles byte-identical to the committed ones and the whole suite passed, as with plain
 * `npm ci`. This keeps a later edit from running them again in any way it can see.
 *
 * A list, not a reader: every line of a workflow or a composite action that names a package manager WATCHED knows, the
 * word "shell", NODE_OPTIONS, BASH_ENV or `node_modules` must be — the spaces around it, and a leading `-` with the
 * spaces after it, set aside — one of LISTED word for word; and after a listed line, up to and including the first line
 * that is neither blank nor a comment, no line may be indented deeper (YAML appends one to a plain value; past a
 * comment line, a parser may). A reader of YAML and shell with its own self-tests still missed, in review, 31 shapes
 * (anchors, flow mappings, folded blank lines and `$( … )` among them) and npm's abbreviations of its own flags — so a
 * watched line that is not listed fails. A shell setting is watched because its template can rewrite a step's script
 * before running it (Grok's round-3 falsification), NODE_OPTIONS and BASH_ENV because they run code before npm or the
 * step's script is read (rounds 6 and 7 of review), and `node_modules` because a dependency's install script lives
 * there. The files must be printable ASCII (a CR only before an LF), so that a line reads the same here, in YAML and in
 * the step's shell. Add a line only after checking that it runs no dependency's script; the one install keeps
 * --ignore-scripts last, and every package script and every lockfile is checked below (the flag does not stop a git or
 * folder dependency's prepare script, so a lockfile may hold registry tarballs only — badPackages).
 *
 * What it cannot see: a spelling that hides a watched name, a dependency's file named by its package
 * (`require('esbuild/install.js')`) among them; a package manager WATCHED does not know, or a tool that runs one (vlt
 * and its vlx, or ni's nci, which runs whichever it finds — round-14 review); another setting that makes a program the
 * step runs load code of its own first (LD_PRELOAD and the like); a script file, third-party action or container image
 * that a workflow uses; or lines put together so that a listed one becomes part of another command (YAML joining a
 * value across lines, a shell continuing one, a function wrapping the call). It guards against an honest edit, not
 * against whoever writes those — they can edit this test too.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ch = (n: number) => String.fromCodePoint(n);
const BACKSLASH = ch(92);
const CR = ch(13);

// What is watched: a package manager that can install packages — npm and npx (pnpm and pnpx contain them, and so does
// every npm_config_ variable), pn and pnx (pnpm's and pnpx's short names since pnpm 11 — round-14 review), yarn, bun
// and bunx, and deno (`deno install --allow-scripts` runs npm packages' install scripts; round-5 review) — the word
// shell (every shell setting, and any other line that spells it), NODE_OPTIONS and BASH_ENV, which change what a listed
// line does without naming npm (a shell template can rewrite the script; NODE_OPTIONS loads code before npm reads its
// flags, and can drop one — round-6 review; bash expands BASH_ENV, command substitutions included, before it reads the
// step's script — round-7 review; both measured), and node_modules. Case does not matter — a Windows runner finds NPM
// as npm.
const WATCHED = /npm|npx|yarn|\bbunx?\b|\bdeno\b|\bpnx?\b|shell|node_options|bash_env|node_modules/i;

const INSTALL = 'run: npm ci --ignore-scripts';
// Every watched line a workflow may hold. Only INSTALL installs; `npm test` and `npm run` run this repo's own scripts
// (checked below), and the rest are not commands.
const LISTED = new Set([
  INSTALL,
  'cache: npm',
  'run: npm test',
  'run: npm run typecheck',
  'npm run build',
  '# Committed bundles must match source (end users run dist/ without npm install).',
]);

const indentOf = (line: string) => line.length - line.trimStart().length;

/** The lines of one workflow or action text that break the rule, numbered from 1. */
function offending(text: string): string[] {
  const out: string[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    // Printable ASCII only, so that a line means here what it means to YAML and the step's shell. A no-break space
    // after the flag reaches npm as part of it, and npm then runs the scripts (round-3 review; measured with npm's own
    // parser); a lone CR ends a line for every YAML parser, NEL, LS and PS for YAML 1.1 ones, but none of them for the
    // split above.
    const chars = [...line];
    const odd = chars.findIndex((c) => c < ' ' || c > '~');
    if (odd >= 0) {
      const code = chars[odd].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
      out.push(`${i + 1}:${odd + 1}: U+${code} is outside printable ASCII`);
    }
    if (!WATCHED.test(line)) return;
    const content = line.trim().replace(/^-\s+/, '');
    if (!LISTED.has(content)) {
      out.push(`${i + 1}: ${line.trim()}`);
      return;
    }
    // Up to the first line that is neither blank nor a comment and not deeper, no line may be deeper than the column: a
    // YAML parser may read past a comment line and append the deeper line to the value (Grok's round-3 falsification).
    const column = line.length - line.trimStart().replace(/^-\s+/, '').length;
    for (const later of lines.slice(i + 1)) {
      if (later.trim() === '') continue;
      if (indentOf(later) > column) {
        out.push(`${i + 1}: ${line.trim()} (a later line is indented deeper)`);
        break;
      }
      if (!later.trimStart().startsWith('#')) break;
    }
  });
  return out;
}

/**
 * Workflows, and composite actions wherever they live — the files GitHub Actions can run steps from. Names match in
 * any case: a Windows runner finds Action.yml when it looks for action.yml, and npm there reads Package.json (round-10
 * review; NTFS ignores case — measured).
 */
const runsSteps = (path: string) => /^\.github\/workflows\/.+\.ya?ml$/i.test(path) || /(^|\/)action\.ya?ml$/i.test(path);
const isManifest = (path: string) => /(^|\/)package\.json$/i.test(path);
const isLockfile = (path: string) => /(^|\/)(package-lock|npm-shrinkwrap)\.json$/i.test(path);

/**
 * What this flags in one package's scripts: a script that names a watched word, and a pre- or post-script, which npm
 * runs around the script it is named for — the ways it can see for `npm test` or `npm run …` to reach a dependency's
 * install script. Every script, not only the ones the listed lines name: one script can run another (`node --run
 * setup` — round-3 review, measured on Node 22). A dependency's file named by its package is outside it, as above.
 */
function badScripts(scripts: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [name, body] of Object.entries(scripts)) {
    if (WATCHED.test(body)) out.push(`${name}: ${body}`);
    for (const hook of [`pre${name}`, `post${name}`]) {
      if (Object.hasOwn(scripts, hook)) out.push(`${hook} runs around ${name}`);
    }
  }
  return out;
}

type LockEntry = { resolved?: string; link?: boolean; name?: string; version?: string };
const REGISTRY_TARBALL = /^https:\/\/registry\.npmjs\.org\/.+\.tgz$/;

/**
 * What this flags in one lockfile: every package but the root that is not a tarball from the npm registry. npm 10 —
 * CI's, with Node 22 — runs a git dependency's `prepare` script to pack it, and a folder dependency's when it links
 * it, even under --ignore-scripts (round-10 review; measured on win32 with npm 10.9.3 and on Linux with 10.9.9, while
 * the same packages' install and postinstall scripts did not run). A lockfile without a packages map is flagged too:
 * there is nothing here to read in it.
 */
function badPackages(lock: { packages?: Record<string, LockEntry> | null }): string[] {
  if (typeof lock.packages !== 'object' || lock.packages === null) return ['no packages map'];
  return Object.entries(lock.packages)
    .filter(([path, entry]) => path !== '' && (entry.link || !REGISTRY_TARBALL.test(entry.resolved ?? '')))
    .map(([path, entry]) => `${path}: ${entry.link ? 'a link' : (entry.resolved ?? 'no resolved URL')}`);
}

describe('CI runs no dependency install script', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' }).split(ch(0));
  const files = tracked.filter(runsSteps);

  it('reads the workflows, and ci.yml installs with the listed line, so the check below is not vacuous', () => {
    expect(files).toContain('.github/workflows/ci.yml');
    const ci = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8').split(/\r?\n/).map((l) => l.trim());
    expect(ci).toContain(INSTALL);
  });

  it('holds printable ASCII only, and names a watched word only on a listed line that never goes on', () => {
    for (const f of files) expect(offending(readFileSync(join(repoRoot, f), 'utf8')), f).toEqual([]);
  });

  // Every tracked package.json: a workflow can run a script in another folder.
  it('holds package scripts that name no watched word and have no pre- or post-script', () => {
    const manifests = tracked.filter(isManifest);
    expect(manifests).toContain('mcp-server/package.json');
    for (const m of manifests) {
      const { scripts = {} } = JSON.parse(readFileSync(join(repoRoot, m), 'utf8')) as { scripts?: Record<string, string> };
      expect(badScripts(scripts), m).toEqual([]);
    }
    const { scripts } = JSON.parse(readFileSync(join(repoRoot, 'mcp-server', 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    const ran = [...LISTED].flatMap((l) => /^(?:run: )?npm (?:run )?([a-z][a-z:-]*)$/.exec(l)?.slice(1) ?? []);
    expect(ran.sort()).toEqual(['build', 'test', 'typecheck']);
    for (const name of ran) expect(scripts[name], name).toBeTypeOf('string');
  });

  it('holds lockfiles of registry tarballs only', () => {
    const lockfiles = tracked.filter(isLockfile);
    expect(lockfiles).toContain('mcp-server/package-lock.json');
    for (const l of lockfiles) {
      const lock = JSON.parse(readFileSync(join(repoRoot, l), 'utf8')) as { packages?: Record<string, LockEntry> };
      expect(badPackages(lock), l).toEqual([]);
      if (l === 'mcp-server/package-lock.json') expect(Object.keys(lock.packages ?? {}).length).toBeGreaterThan(100);
    }
  });
});

describe('the rule itself', () => {
  const workflow = (steps: string[]) =>
    ['on: push', 'jobs:', '  j:', '    runs-on: ubuntu-latest', '    steps:', ...steps.map((l) => `      ${l}`)].join('\n');

  // Shapes a later edit could take that run a dependency's install script, or might — all from review.
  it.each([
    ['plain npm ci', ['- run: npm ci']],
    ['npm install', ['- run: npm install']],
    ['npm i', ['- run: npm i']],
    ['npm ci under another directory', ['- run: npm --prefix mcp-server ci']],
    ['an alias of ci', ['- run: npm clean-install']],
    ['npm update', ['- run: npm update']],
    ['npm up, even with the flag', ['- run: npm up --ignore-scripts']],
    ['npm dedupe', ['- run: npm dedupe']],
    ['npm audit fix', ['- run: npm audit fix']],
    ['npm rebuild', ['- run: npm rebuild']],
    ['a later --no-ignore-scripts', ['- run: npm ci --ignore-scripts --no-ignore-scripts']],
    ['npm abbreviating --no-ignore-scripts', ['- run: npm ci --no-ignore-script']],
    ['npm abbreviating --ignore-scripts=false', ['- run: npm ci --ignore-script=false']],
    ['--ignore-scripts false', ['- run: npm ci --ignore-scripts false']],
    ['npx running npm', ['- run: npx --yes npm@11 ci']],
    ['npx fetching a package', ['- run: npx --yes some-tool']],
    ['npx -p', ['- run: npx -p npm@11 npm ci']],
    ['an anchor', ['- run: &install npm ci']],
    // without a space after it the dash is part of the key, not a sequence entry (round-8 review)
    ['a dash with no space after it', ['-run: npm ci --ignore-scripts']],
    ['an alias of an anchored command', ['- name: a', '  env:', '    CMD: &cmd npm ci', '  run: echo first', '- run: *cmd']],
    ['a flow mapping', ['- { name: Install, run: npm ci }']],
    ['a quoted key', ['- "run": npm ci']],
    ['a space before the colon', ['- run : npm ci']],
    ['a value on two lines', ['- run: npm', '    ci']],
    ['the listed install going on to the next line', ['- name: Install', `  ${INSTALL}`, '    --no-ignore-scripts']],
    ['a deeper line past a comment after the listed install', ['- name: Install', `  ${INSTALL}`, '  # c', '    --no-ignore-scripts']],
    // the edges of the scan: one column deeper is deeper, and a blank line does not end it (round-7 review)
    ['the listed install going on one column deeper', ['- name: Install', `  ${INSTALL}`, '   --no-ignore-scripts']],
    ['the listed install going on past a blank line', ['- name: Install', `  ${INSTALL}`, '', '    --no-ignore-scripts']],
    ['a deeper comment after the listed install (parsers differ on what follows)', ['- name: Install', `  ${INSTALL}`, '    # c']],
    ['a YAML escape', [`- run: "npm${BACKSLASH}x20ci"`]],
    ['an indentation indicator', ['- run: |2', '      npm ci']],
    ['a shell line continued', ['- run: |', `    npm ${BACKSLASH}`, '      ci']],
    ['a folded block with a blank line', ['- run: >', '    echo start', '', '    npm ci']],
    ['a folded block, more indented', ['- run: >', '    echo start', '      npm ci']],
    ['a # inside quotes', ['- run: |', '    echo "step #1" && npm ci']],
    ['a quoted variable before it', ['- run: NODE_OPTIONS="--max-old-space-size=4096 --trace-warnings" npm ci']],
    ['sh -c', ['- run: sh -c "npm ci"']],
    ['a subshell', ['- run: (cd . && npm ci)']],
    ['env', ['- run: env npm ci']],
    ['command', ['- run: command npm ci']],
    ['time', ['- run: time npm ci']],
    ['sudo', ['- run: sudo npm ci']],
    ['a background job', ['- run: sleep 0 & npm ci']],
    ['a negation', ['- run: "! npm ci"']],
    ['if … then', ['- run: if true; then npm ci; fi']],
    ['command substitution', ['- run: echo $(npm ci)']],
    ['an npm config variable', ['- env:', '    NPM_CONFIG_IGNORE_SCRIPTS: "false"', `  ${INSTALL}`]],
    ['upper case', ['- run: NPM ci']],
    ['a lone CR between two lines', [`- run: npm test${CR}  run: npm ci`]],
    // a YAML parser ends the comment at the CR, so what follows is a deeper line after a comment, which a parser may
    // append to the install (round-3 review; PyYAML 6.0.3 rejects it, as it does the LF form — round-12 review,
    // measured); the ASCII rule is what rejects it here, since the split above sees one line there (round-11 review)
    ['a lone CR inside a comment', ['- name: Install', `  ${INSTALL}`, `  # c${CR}          --no-ignore-scripts`]],
    // nothing but the lone CR is wrong here: the ASCII rule alone rejects it (round-4 review)
    ['a lone CR alone', ['- name: Install', `  ${INSTALL}`, `  # c${CR}  # d`]],
    // npm reads the flag and the character after it as one unknown flag, and runs the scripts (round-3 review)
    ['a no-break space after the flag', ['- name: Install', `  ${INSTALL}${ch(0xa0)}`]],
    ['an ideographic space after the flag', ['- name: Install', `  ${INSTALL}${ch(0x3000)}`]],
    // the lone CR's case with a NEL, a line end for YAML 1.1 parsers — the ASCII rule rejects it too
    ['a NEL inside a comment, a line end for some YAML parsers', ['- name: Install', `  ${INSTALL}`, `  # c${ch(0x85)}          --no-ignore-scripts`]],
    ['yarn', ['- run: yarn install']],
    ['pnpm', ['- run: pnpm install']],
    // pnpm 11's short names, which hold neither npm nor npx (round-14 review)
    ['pn, pnpm under its short name', ['- run: pn install']],
    ['pnx, pnpx under its short name', ['- run: pnx some-tool']],
    // a name with punctuation next to it, as Windows writes a shim or a binary: the edge is a word's, not a space's
    // (round-15 review)
    ['pn by its Windows shim', ['- run: pn.cmd install']],
    ['pnx by its Windows shim', ['- run: pnx.cmd some-tool']],
    ['bun by its Windows name', ['- run: bun.exe install']],
    ['deno by its Windows name', ['- run: deno.exe install --allow-scripts']],
    ['bun', ['- run: bun install']],
    ['deno', ['- run: deno install --allow-scripts']],
    // the reach the comment above WATCHED gives it — pnpx through npx, bunx, and shell anywhere in a line, at the start
    // of a name or at its end — and yarnpkg, yarn's other name, which holds yarn (rounds 13 and 14 of review)
    ['yarnpkg, yarn under its other name', ['- run: yarnpkg install']],
    ['pnpx, which holds npx', ['- run: pnpx some-tool']],
    ['bunx', ['- run: bunx some-tool']],
    ['a variable whose name starts with shell', ['- name: Install', '  env:', '    SHELLOPTS: xtrace', `  ${INSTALL}`]],
    ['a command whose name ends in shell', ['- run: powershell -File x.ps1']],
    // node loads this before npm reads its flags, and it drops the last one (round-6 review, measured with npm 10.9)
    ['NODE_OPTIONS on the install step', ['- name: Install', '  env:', '    NODE_OPTIONS: --import data:text/javascript,process.argv.pop()', `  ${INSTALL}`]],
    ['NODE_OPTIONS through GITHUB_ENV', ['- run: echo "NODE_OPTIONS=--require ./x.js" >> "$GITHUB_ENV"', `- ${INSTALL}`]],
    // bash expands this before it reads the step's script, and the sed removes the flag (round-7 review, measured)
    ['BASH_ENV on the install step', ['- name: Install', '  env:', `    BASH_ENV: $(sed -i 's/ --ignore-scripts//' "$0")`, `  ${INSTALL}`]],
    ['an install action', ['- uses: bahmutov/npm-install@v1']],
    // a shell template runs a step's script file as it likes, and can rewrite it first (Grok's round-3 falsification)
    ['a shell template that rewrites the script', ['- name: Install', `  shell: bash -c "sed -i 's/--ignore-scripts//g' '{0}'; bash '{0}'"`, `  ${INSTALL}`]],
    ['a shell setting, a built-in shell included', ['- name: Install', '  shell: bash', `  ${INSTALL}`]],
    // a dependency's own install script, run by its path (round-4 review)
    ['an install script run by its path', ['- run: node node_modules/esbuild/install.js']],
    // a watched word on the line after a listed one, which a WATCHED with the g flag would look for only past the end
    // of the last match (round-18 review)
    ['an unlisted line straight after a listed one', ['- run: npm test', '- run: npm ci']],
  ])('rejects %s', (_shape, steps) => {
    expect(offending(workflow(steps)).length).toBeGreaterThan(0);
  });

  // Every watched name in a step with no space next to it — `./name.cmd` for the names WATCHED bounds as words,
  // `xNAMEx` for the others — so that narrowing either edge of an alternative to a space, to whitespace or to a word
  // boundary fails a step (rounds 13 to 16 of review each found one more edge).
  const BOUNDED = ['bun', 'bunx', 'deno', 'pn', 'pnx'];
  const INSIDE = ['npm', 'npx', 'yarn', 'shell', 'NODE_OPTIONS', 'BASH_ENV', 'node_modules'];
  it.each([...BOUNDED.map((name) => `- run: ./${name}.cmd x`), ...INSIDE.map((name) => `- run: x${name}x y`)])(
    'rejects the step %s',
    (step) => {
      expect(offending(workflow([step])).length).toBeGreaterThan(0);
    },
  );

  // The lists have to keep up with WATCHED: each of its alternatives is a name, its last letter optional or not,
  // bounded as a word on both sides or on neither, and every name it spells is in the list its edges call for
  // (round-17 review: a name added to WATCHED would otherwise fall outside the table unseen).
  it('lists every name WATCHED spells, in the list its edges call for', () => {
    const spelled = (name: string) => (name.endsWith('?') ? [name.slice(0, -2), name.slice(0, -1)] : [name]);
    const found: Record<'bounded' | 'inside', string[]> = { bounded: [], inside: [] };
    for (const alternative of WATCHED.source.split('|')) {
      const shape = /^(\\b)?([a-z_]+\??)(\\b)?$/.exec(alternative);
      expect(shape, alternative).not.toBeNull();
      expect(shape?.[1] === shape?.[3], alternative).toBe(true);
      found[shape?.[1] ? 'bounded' : 'inside'].push(...spelled(shape?.[2] ?? ''));
    }
    expect(found.bounded.sort()).toEqual(BOUNDED.map((name) => name.toLowerCase()).sort());
    expect(found.inside.sort()).toEqual(INSIDE.map((name) => name.toLowerCase()).sort());
  });

  // Only the i flag: with g, test() searches a line only past where a match on the line before it ended; with y, only
  // at that point, so after a line with no match, no indented line matches (rounds 18 and 19 of review).
  it('matches in any case and keeps no state from one line to the next', () => {
    expect(WATCHED.flags).toBe('i');
  });

  const accepted = workflow([
    '- uses: actions/setup-node@v4',
    '  with:',
    '    node-version: "22"',
    '    cache: npm',
    '    cache-dependency-path: mcp-server/package-lock.json',
    '# Committed bundles must match source (end users run dist/ without npm install).',
    '- name: Install dependencies',
    `  ${INSTALL}`,
    '- name: Unit tests',
    '  run: npm test',
    '- run: npm run typecheck',
    '  name: Typecheck', // a key of the same step, not a continuation
    '- name: Verify dist is up to date',
    '  run: |',
    '    npm run build',
    '    git diff --exit-code -- dist/index.js dist/hook.js',
  ]);

  it('accepts the listed lines in the shapes ci.yml writes them', () => {
    expect(offending(accepted)).toEqual([]);
  });

  it('accepts them with CRLF line ends too, as a Windows checkout has them', () => {
    expect(offending(accepted.split('\n').join(`${CR}\n`))).toEqual([]);
  });

  it('names the character it rejects and where', () => {
    expect(offending(workflow(['- name: Install', `  ${INSTALL}${ch(0xa0)}`]))).toContain('7:37: U+00A0 is outside printable ASCII');
  });

  it.each([
    ['a script chained through node --run', { build: 'node --run setup', setup: 'npm ci' }],
    ['a pre-script', { test: 'vitest run', pretest: 'node -v' }],
    ['a post-script of a script no listed line runs', { 'probe:home': 'node scripts/x.mjs', 'postprobe:home': 'node -v' }],
    ['an install script run by its path', { setup: 'node node_modules/esbuild/install.js' }],
  ])('flags package scripts with %s', (_shape, scripts) => {
    expect(badScripts(scripts).length).toBeGreaterThan(0);
  });

  it('accepts package scripts like the ones mcp-server/package.json holds', () => {
    expect(badScripts({ build: 'node build.mjs', test: 'vitest run', typecheck: 'tsc --noEmit', 'probe:home': 'node scripts/probe-home-lookup.mjs' })).toEqual([]);
  });

  it('reads every package.json, in any case, not other JSON', () => {
    for (const f of ['package.json', 'mcp-server/package.json', 'tools/x/package.json', 'tools/x/Package.json']) expect(isManifest(f), f).toBe(true);
    for (const f of ['mcp-server/package-lock.json', 'my-package.json', 'docs/specs/samples/x.json']) expect(isManifest(f), f).toBe(false);
  });

  it('reads every lockfile, in any case, not other JSON', () => {
    for (const f of ['mcp-server/package-lock.json', 'package-lock.json', 'tools/x/npm-shrinkwrap.json', 'tools/x/Package-Lock.json']) {
      expect(isLockfile(f), f).toBe(true);
    }
    for (const f of ['mcp-server/package.json', 'my-package-lock.json', 'docs/specs/samples/x.json']) expect(isLockfile(f), f).toBe(false);
  });

  const root = { '': { name: 'mcp-server' } };
  const fromRegistry = (name: string) => ({ resolved: `https://registry.npmjs.org/${name}/-/${name.split('/').pop()}-1.0.0.tgz` });

  // Shapes npm writes for packages it would not take from the registry, and edges of the URL test.
  it.each([
    ['a git dependency', { 'node_modules/gitdep': { resolved: 'git+ssh://git@github.com/o/r.git#0123456789abcdef' } }],
    ['a git dependency of a dependency', { 'node_modules/a': fromRegistry('a'), 'node_modules/a/node_modules/g': { resolved: 'git+ssh://git@github.com/o/g.git#0123456789abcdef' } }],
    // what npm 10.9 wrote for `file:../dirdep`: the folder, and the link to it
    ['a folder dependency', { '../dirdep': { version: '1.0.0' }, 'node_modules/dirdep': { resolved: '../dirdep', link: true } }],
    ['a link, whatever its URL', { 'node_modules/x': { ...fromRegistry('x'), link: true } }],
    ['a tarball from another host', { 'node_modules/x': { resolved: 'https://example.com/x/-/x-1.0.0.tgz' } }],
    ['a host that only starts like the registry', { 'node_modules/x': { resolved: 'https://registry.npmjs.org.example.com/x/-/x-1.0.0.tgz' } }],
    // each dot of the host is a dot, not any character (round-11 review)
    ['a host with a dash for the registry host\'s first dot', { 'node_modules/x': { resolved: 'https://registry-npmjs.org/x/-/x-1.0.0.tgz' } }],
    ['a host with a dash for the registry host\'s second dot', { 'node_modules/x': { resolved: 'https://registry.npmjs-org/x/-/x-1.0.0.tgz' } }],
    ['the registry without TLS', { 'node_modules/x': { resolved: 'http://registry.npmjs.org/x/-/x-1.0.0.tgz' } }],
    ['a git URL on the registry host', { 'node_modules/x': { resolved: 'git+https://registry.npmjs.org/x/-/x-1.0.0.tgz' } }],
    ['a registry URL that goes on past .tgz', { 'node_modules/x': { resolved: 'https://registry.npmjs.org/x/-/x-1.0.0.tgz.git' } }],
    ['no resolved URL', { 'node_modules/x': { version: '1.0.0' } }],
  ])('flags a lockfile with %s', (_shape, packages) => {
    expect(badPackages({ packages: { ...root, ...packages } as Record<string, LockEntry> }).length).toBeGreaterThan(0);
  });

  it('flags a lockfile without a packages map', () => {
    expect(badPackages({})).toEqual(['no packages map']);
    expect(badPackages({ packages: null })).toEqual(['no packages map']); // JSON can say null (round-11 review)
  });

  it('accepts a lockfile of registry tarballs, scoped ones included', () => {
    expect(badPackages({ packages: { ...root, 'node_modules/esbuild': fromRegistry('esbuild'), 'node_modules/@esbuild/linux-x64': fromRegistry('@esbuild/linux-x64') } })).toEqual([]);
  });

  it('reads workflows and composite actions, wherever an action lives and in any case — not other YAML', () => {
    for (const f of ['.github/workflows/ci.yml', '.github/workflows/nested/x.yaml', '.github/actions/setup/action.yml', 'tools/ci/action.yaml', 'action.yml', '.github/actions/win/Action.yml', '.github/workflows/CI.YML']) {
      expect(runsSteps(f), f).toBe(true);
    }
    for (const f of ['.github/dependabot.yml', 'docs/specs/samples/x.yml', 'my-action.yml', 'mcp-server/test/ci-workflow.test.ts']) {
      expect(runsSteps(f), f).toBe(false);
    }
  });

  it('lists one install, which ends in --ignore-scripts; every other listed command runs one of this repo’s scripts', () => {
    expect(INSTALL).toMatch(/^run: npm ci --ignore-scripts$/);
    for (const line of LISTED) {
      if (line === INSTALL || line === 'cache: npm' || line.startsWith('#')) continue;
      expect(line).toMatch(/^(run: )?npm (test|run [a-z][a-z:-]*)$/);
    }
  });
});
