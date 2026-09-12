# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security report.**

Use GitHub's private vulnerability reporting on this repository:
**Security → Advisories → Report a vulnerability**
(<https://github.com/xzawed/claude-grok-build-plugin/security/advisories/new>).

Private reporting is enabled, so the report stays visible only to you and the maintainer until
a fix ships. Please include the plugin version (`/grok:status` → `serverVersion`), your OS, and
the smallest reproduction you have. A first response should arrive within a few days; there is
no paid bounty for this project.

## Supported versions

Only the **latest release** is supported. The plugin cache is keyed by version
(`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`), so fixes reach users through a
new version — there are no backports to older tags. Update with:

```bash
claude plugin marketplace update grok-marketplace   # refresh the clone first
claude plugin update grok@grok-marketplace
```

The clone must be refreshed first: it is installed with `autoUpdate: false`, so a stale clone
makes `plugin update` unable to see the new version at all.

## Scope

**In scope** — anything this repository ships:

- the MCP server (`mcp-server/src/`, and the committed bundle `mcp-server/dist/index.js`)
- the PreToolUse auth hook (`mcp-server/dist/hook.js`, `hooks/hooks.json`)
- plugin manifests, `commands/`, `skills/`, `agents/`

**Out of scope** — report these to their own vendors:

- the `grok` CLI itself and xAI's services (<https://x.ai>) — this plugin only wraps the CLI
- Claude Code and its plugin loader (<https://github.com/anthropics/claude-code>)

## What this plugin does with credentials

These are design guarantees, verifiable in the source, and useful context for a report:

- **It never stores credentials and never logs them.** Authentication is entirely
  `grok login` (browser OAuth, producing `~/.grok/auth.json`) or an API key already in your
  environment. The plugin does not write either to disk.
- **Subscription mode strips pay-as-you-go credentials.** With the default
  `GROK_BUILD_AUTH_MODE=subscription`, `XAI_API_KEY` and `GROK_CODE_XAI_API_KEY` are removed
  from the environment handed to the `grok` child process (`mcp-server/src/env.ts`,
  `buildGrokEnv`). A run with no valid session then fails loudly with `auth_error` instead of
  silently falling back to metered billing. Set `GROK_BUILD_AUTH_MODE=api` to opt into passing
  the key through; responses then report `billing: "metered_api"`.
- **Grok edits files directly, and never commits.** Headless delegation requires
  `--always-approve` (`mcp-server/src/delegate.ts`), so edits land in the target `cwd` — or in
  an isolated worktree with `worktree: true`. Nothing is committed; a human reviews the diff.

### Known limitation — prompts are previewed in the delegation history

`~/.grok-build/history.jsonl` records the **first 200 characters** of each delegated prompt, and
`grok_build_usage` / `grok_build_status` replay it. `redactSecrets` in
`mcp-server/src/history.ts` masks known secret shapes — vendor key prefixes (xAI, AWS, GitHub,
Slack), JWTs, `Bearer`/`Basic` headers, `password:`/`api_key:`-style assignments, credentials
embedded in connection strings, and PEM private-key blocks — but **masking is a mitigation, not a
guarantee**: an unrecognised secret shape can be written to that file.

Do not paste secrets into delegation prompts. A *new* secret shape that slips past the redactor
is a valid report; the file living on your own machine, with a preview of what you typed, is the
documented design.

## Supply chain

`mcp-server/dist/index.js` and `mcp-server/dist/hook.js` are **committed esbuild bundles** — end
users execute them without ever running `npm install`, so runtime dependencies are inlined. CI
rebuilds and compares them on every pull request (`.github/workflows/ci.yml`, Linux job), which
makes a bundle that disagrees with its source a build failure rather than a silent ship.

Dependency alerts (Dependabot) and secret scanning with push protection are enabled on this
repository. Dependency vulnerabilities that are already public do not need a private report —
open a normal issue or a pull request.
