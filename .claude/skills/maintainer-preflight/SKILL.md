---
name: maintainer-preflight
description: Use before claiming work is done, before committing, and before opening a PR in this repo — runs the mcp-server test/typecheck/build gates and the committed-bundle rule. Trigger on "done", "ready to commit", "open a PR", or any completion claim.
---

# Maintainer preflight (claude-grok-build-plugin)

Run these before saying done. Evidence, not vibes.

## Always

```bash
cd mcp-server
npm ci          # only when node_modules is missing
npm test
npm run typecheck
```

Both must pass. Report the real counts from this session's run — never summarize a run you
did not execute.

## If you touched anything that changes the bundle

That means **any** of these — not just source:

- `mcp-server/src/**`
- `mcp-server/package-lock.json` or `mcp-server/package.json` (dependency bumps)

```bash
cd mcp-server
npm ci                # required after a lockfile change
npm run build
git add dist/index.js dist/hook.js
```

Why the lockfile counts: `build.mjs` runs esbuild with `bundle: true`, so runtime
dependencies are **inlined** into `dist/index.js` (~805KB). A lockfile-only bump therefore
changes the committed bundle. This is not hypothetical — PR #27 (`fast-uri` 3.1.3 → 3.1.4)
touched no source file and still required a rebuild.

End users execute the **committed** bundles without ever running `npm install`. A commit that
changes the dependency graph or the source without both regenerated bundles ships a plugin
whose behaviour does not match its inputs. CI catches it on Linux by comparing content — but
only after you push.

Staging `dist/` is not the same as rebuilding it. Run the build.

## Dependency PRs (Dependabot) — you own the rebuild

**A human must never run `npm run build` to land a dependency PR.** When a Dependabot PR
turns CI red on the dist check, the agent landing it does this on the PR branch:

```bash
cd mcp-server && npm ci && npm test && npm run typecheck && npm run build
git add dist/index.js dist/hook.js && git commit -m "chore(deps): rebuild dist after <dep> bump"
```

Then push to the PR branch. The human's only remaining step is reviewing and merging.

## If you touched `hooks/hooks.json`

The wrapped shape is mandatory:

```json
{ "hooks": { "PreToolUse": [ … ] } }
```

A bare `{ "PreToolUse": … }` makes Claude Code report **Status: failed to load**, and every
`/grok:*` command disappears. `hooks-contract.test.ts` guards this — do not skip it.

## If you bumped the version

`.claude-plugin/plugin.json` and `mcp-server/package.json` move together. `handoff-version.test.ts`
additionally requires `docs/releases/v<version>.md` and that version string in `CLAUDE.md` and
`docs/09-scope-and-residuals.md`.

## Never

- Commit directly to `main` — the ruleset requires a PR
- Auto-commit Grok's output — a human reviews the diff first
- Claim green from a run you did not execute in this session
