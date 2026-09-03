# Sandbox profiles (measured)

> **Section validity differs.** The profile table below is the 2026-07-25 pre-1.0 snapshot
> (re-checked against the installed user-guide, unchanged). The "Resuming a session" section is
> measured on 1.0.13 (2026-09-03).

- Date: 2026-07-25
- Sources: installed Grok user-guide `~/.grok/docs/user-guide/18-sandbox.md`,
  `grok --help` (`--sandbox <PROFILE>`, env `GROK_SANDBOX`), headless Win32 probe.

## Built-in profiles

| Profile | FS read | FS write | Child network | Typical use |
|---|---|---|---|---|
| `off` (default) | unrestricted | unrestricted | unrestricted | no sandbox |
| `workspace` | everywhere | CWD + `~/.grok/` + temp | allowed | everyday dev |
| `devbox` | everywhere | most top-level except `/data` | allowed | disposable VMs |
| `read-only` | everywhere | `~/.grok/` + temp only | blocked¹ | review / explore |
| `strict` | CWD + system paths | CWD + `~/.grok/` + temp | blocked¹ | untrusted code |

¹ Child-network block: **Linux only** (seccomp). macOS no-op for child network.

Custom profiles: `~/.grok/sandbox.toml` or project `.grok/sandbox.toml` (`extends`, `deny`, …).

## Platform enforcement

| Platform | Mechanism |
|---|---|
| Linux | Landlock (kernel ≥ 5.13); custom `deny` may need bubblewrap |
| macOS | Seatbelt |
| Windows | **Not listed** in grok’s platform table. Headless probe 2026-07-25:  
  `grok --sandbox workspace -p "…" --output-format json` → `stopReason: EndTurn`  
  (flag accepted; do **not** assume kernel FS enforcement on Win32) |

If sandbox cannot apply, grok typically warns and continues (except failed **custom** profiles which may refuse to start).

## Plugin wiring

- MCP: `sandbox` on `grok_build_delegate` / `grok_build_verify` → `--sandbox <profile>`
- Validation: `SAFE_CLI_TOKEN` (allows `read-only` hyphen)
- Known list constant: `KNOWN_SANDBOX_PROFILES` in `delegate.ts`
- Recommendation: prefer `worktree: true` + `sandbox: "workspace"` or `"strict"` for risky work on Linux/macOS; on Windows prefer worktree isolation over relying on sandbox.

## Resuming a session — the profile is fixed (measured 1.0.13, 2026-09-03)

A session stores the profile it was created with, and resume will not change it:

| Resume invocation | Result |
|---|---|
| `--resume <id>` (no `--sandbox`) | resumes under the saved profile |
| `--resume <id> --sandbox <same>` | allowed |
| `--resume <id> --sandbox <different>` | **refused** — exit 1, empty stdout, error on stderr |

Measured refusal text: `error: cannot resume this session under sandbox profile 'read-only' —`
`it was created with 'workspace'. Omit --sandbox to resume with 'workspace', or start a new`
`session to use 'read-only'.`

Plugin consequence: `grok_build_delegate({ resume, sandbox })` with a mismatch surfaces as
`grok_error` with grok’s own sentence in `rawStderrTail` — actionable, so no extra guard exists.
Full trace: `grok-cli-contract.md` §11.

## Recommendation for this plugin’s safety model

| Risk | Suggest |
|---|---|
| Low bulk edits | optional `workspace` |
| Review / plan-adjacent | `read-only` if only analysis needed (plan mode already no edits) |
| Untrusted / high blast radius | `strict` + `worktree: true` (Linux/macOS) |
