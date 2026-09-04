#!/usr/bin/env node
/**
 * Guard against the v0.2.12 failure: a version declared on main that never got a tag or a
 * release.
 *
 * Why that is worth a gate. The marketplace source is `./` and the plugin cache is keyed by
 * version (`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`). A number that is
 * declared but never tagged still gets installed and cached, so a later, different bundle
 * published under the same number leaves two artifacts sharing one version string and
 * `/grok:status` can no longer say which one is installed. v0.2.12 did exactly this and had to
 * be abandoned rather than reused.
 *
 * Why this is NOT wired to push/pull_request. The commit that declares a new version
 * legitimately lands BEFORE the tag is pushed — that is the documented order in CONTRIBUTING
 * ("merge, then tag immediately"). Running this on every PR would fail every release PR for a
 * reason that is not a defect. It runs on a schedule and on demand instead, where "declared
 * days ago, still untagged" is unambiguous.
 *
 * Usage:
 *   node mcp-server/scripts/check-release-tag.mjs
 *
 * Env:
 *   RELEASE_CHECK_VERSION  override the declared version (used to prove the gate can fail)
 *   RELEASE_CHECK_SKIP_GH  set to 1 to check only the git tag, skipping the GitHub release
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

const declared =
  process.env.RELEASE_CHECK_VERSION ||
  JSON.parse(readFileSync(join(repoRoot, 'mcp-server/package.json'), 'utf8')).version;

const tag = `v${declared}`;
const problems = [];

const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// 1. The git tag must exist. CI must check out with fetch-depth: 0 — a shallow clone has no tags,
//    which would make this pass or fail for the wrong reason.
let tagged = false;
try {
  run('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`]);
  tagged = true;
} catch {
  problems.push(`no git tag ${tag} (mcp-server/package.json declares ${declared})`);
}

// 2. The GitHub release must exist too. A tag without a release is invisible to anyone reading
//    the repo's Releases page, which is where docs/09 points for "what shipped".
if (!process.env.RELEASE_CHECK_SKIP_GH) {
  try {
    run('gh', ['release', 'view', tag, '--json', 'tagName']);
  } catch {
    problems.push(`no GitHub release ${tag} (\`gh release view ${tag}\` failed)`);
  }
}

if (problems.length) {
  console.error(`Declared version ${declared} is not fully shipped:`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('');
  console.error('Fix: push the tag and cut the release, or bump to a version you intend to ship.');
  console.error('Never re-publish a different bundle under an already-installed version — the');
  console.error('plugin cache is keyed by version. See CLAUDE.md and docs/releases/v0.2.13.md.');
  process.exit(1);
}

console.log(`ok: ${declared} is tagged${tagged ? '' : '?'} and released as ${tag}`);
