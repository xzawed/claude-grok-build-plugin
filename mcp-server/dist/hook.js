import { createRequire as __createRequire } from 'module'; const require = globalThis.require ?? __createRequire(import.meta.url);

// src/auth.ts
import { existsSync } from "node:fs";
import { join as join3 } from "node:path";
import { spawnSync } from "node:child_process";

// src/env.ts
import { homedir } from "node:os";
import { join, delimiter } from "node:path";
var API_KEY_VARS = ["XAI_API_KEY", "GROK_CODE_XAI_API_KEY"];
var API_KEY_VARS_LOWER = new Set(API_KEY_VARS.map((k) => k.toLowerCase()));
function grokHome(env) {
  return env.GROK_HOME && env.GROK_HOME.length > 0 ? env.GROK_HOME : join(homedir(), ".grok");
}
function grokBinDir(env) {
  return env.GROK_BIN_DIR && env.GROK_BIN_DIR.length > 0 ? env.GROK_BIN_DIR : join(homedir(), ".grok", "bin");
}
function prependGrokBin(env) {
  const dir = grokBinDir(env);
  const pathKey = Object.hasOwn(env, "PATH") ? "PATH" : Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  const current = env[pathKey] ?? "";
  const parts = current.split(delimiter).filter(Boolean);
  if (parts.includes(dir)) return { ...env };
  return { ...env, [pathKey]: current ? `${dir}${delimiter}${current}` : dir };
}

// src/version.ts
import { readFileSync } from "node:fs";
import { dirname, join as join2 } from "node:path";
import { fileURLToPath } from "node:url";
function getServerVersion() {
  const pkgPath = join2(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  try {
    const v = JSON.parse(readFileSync(pkgPath, "utf8")).version;
    if (typeof v === "string" && v.length > 0) return v;
  } catch {
  }
  return "0.2.20";
}

// src/auth.ts
function billingForMode(mode) {
  return mode === "api" ? "metered_api" : "subscription";
}
function baseAuthFields(mode) {
  return {
    mode,
    billing: billingForMode(mode),
    serverVersion: getServerVersion()
  };
}
function grokNotInstalledMessage(platform = process.platform) {
  const install = platform === "win32" ? "PowerShell: `irm https://x.ai/cli/install.ps1 | iex`" : "`curl -fsSL https://x.ai/cli/install.sh | bash`";
  return "Grok Build CLI\uB97C PATH\uC5D0\uC11C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uBBF8\uC124\uCE58\uBA74 " + install + " \uB85C \uC124\uCE58\uD558\uACE0, \uC774\uBBF8 \uC124\uCE58\uD588\uB2E4\uBA74 grok\uC774 PATH\uC5D0 \uD3EC\uD568\uB41C \uD130\uBBF8\uB110\uC5D0\uC11C Claude Code\uB97C \uC2E4\uD589\uD558\uC138\uC694. (Windows: \uC124\uCE58 \uD6C4 \uC0C8 \uD130\uBBF8\uB110\uC744 \uC5F4\uAC70\uB098 Claude Code\uB97C \uC7AC\uC2DC\uC791\uD558\uC138\uC694.)";
}
var GROK_NOT_INSTALLED_MESSAGE = grokNotInstalledMessage();
function authFilePath(env) {
  return join3(grokHome(env), "auth.json");
}
var PROBE_TIMEOUT_MS = 5e3;
var PROBE_MAX_BUFFER = 1024 * 1024;
function grokBinNames(platform = process.platform) {
  return platform === "win32" ? ["grok.exe", "grok.cmd", "grok.bat", "grok"] : ["grok"];
}
function resolveGrokInstalled(opts) {
  if (opts.pathLookupOk) return true;
  return grokBinNames(opts.platform).some((name) => opts.fileExists(join3(opts.binDir, name)));
}
function checkAuth(mode, deps) {
  const base = baseAuthFields(mode);
  if (!deps.grokInstalled()) {
    return { ok: false, ...base, reason: "grok_not_installed", message: GROK_NOT_INSTALLED_MESSAGE };
  }
  if (mode === "subscription") {
    if (!deps.authFileExists()) {
      return {
        ok: false,
        ...base,
        reason: "not_logged_in",
        message: "\uAD6C\uB3C5 \uB85C\uADF8\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4. \uD130\uBBF8\uB110\uC5D0\uC11C `grok login`\uC744 \uC2E4\uD589\uD55C \uB4A4 \uB2E4\uC2DC \uC2DC\uB3C4\uD558\uC138\uC694."
      };
    }
    return { ok: true, ...base, message: "\uAD6C\uB3C5 \uC138\uC158 \uC778\uC99D \uC900\uBE44\uB428." };
  }
  const hasKey = Boolean(deps.env.XAI_API_KEY || deps.env.GROK_CODE_XAI_API_KEY);
  if (!hasKey) {
    return {
      ok: false,
      ...base,
      reason: "no_api_key",
      message: "API \uBAA8\uB4DC\uC785\uB2C8\uB2E4. `XAI_API_KEY` \uD658\uACBD\uBCC0\uC218\uB97C \uC124\uC815\uD55C \uB4A4 \uB2E4\uC2DC \uC2DC\uB3C4\uD558\uC138\uC694."
    };
  }
  return { ok: true, ...base, message: "API \uD0A4 \uC778\uC99D \uC900\uBE44\uB428." };
}
function defaultAuthDeps(env = process.env) {
  return {
    grokInstalled: () => {
      const probeEnv = prependGrokBin(env);
      let pathLookupOk = false;
      const probeBounds = { timeout: PROBE_TIMEOUT_MS, maxBuffer: PROBE_MAX_BUFFER };
      if (process.platform === "win32") {
        const probe = spawnSync("where.exe", ["grok"], {
          env: probeEnv,
          windowsHide: true,
          encoding: "utf8",
          ...probeBounds
        });
        pathLookupOk = probe.status === 0 && Boolean((probe.stdout || "").trim());
      } else {
        const probe = spawnSync("sh", ["-c", "command -v grok"], { env: probeEnv, ...probeBounds });
        pathLookupOk = probe.status === 0;
      }
      return resolveGrokInstalled({
        platform: process.platform,
        binDir: grokBinDir(probeEnv),
        fileExists: existsSync,
        pathLookupOk
      });
    },
    authFileExists: () => existsSync(authFilePath(env)),
    env
  };
}

// src/delegate.ts
import { spawn, execFile as execFile2 } from "node:child_process";
import { promisify as promisify2 } from "node:util";

// src/history.ts
var NAMED_KEYS = "XAI_API_KEY|GROK_CODE_XAI_API_KEY|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN|SLACK_TOKEN";
var GENERIC_KEYS = "password|passwd|pwd|secret|client_secret|access_token|refresh_token|auth_token|api[_-]?key|access[_-]?key|private[_-]?key";
var ASSIGNMENT = new RegExp(
  `(["']?)\\b(${NAMED_KEYS}|${GENERIC_KEYS})\\b\\1(\\s*[=:]\\s*)(["']?)([^\\s"',}]+)\\4`,
  "gi"
);
var IS_NAMED_KEY = new RegExp(`^(?:${NAMED_KEYS})$`, "i");

// src/worktree.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var GIT_MAX_BUFFER = 16 * 1024 * 1024;
var MS_PER_DAY = 24 * 60 * 60 * 1e3;

// src/delegate.ts
var execFileAsync2 = promisify2(execFile2);
var STDOUT_CAP_BYTES = 16 * 1024 * 1024;
var STDERR_CAP_BYTES = 1024 * 1024;
var VERIFY_PROMPT_SUFFIX = [
  "",
  "---",
  "After you finish the task, verify your own work before ending the turn:",
  "1. Re-read every file you changed.",
  "2. Run the project's relevant tests or typecheck if they exist and are cheap; if none, say so.",
  "3. In your final reply, include a short Verification checklist (item / pass|fail / note) and any remaining risks.",
  "Do not commit. Do not start unrelated work."
].join("\n");

// src/grok-cli.ts
var NON_HEADLESS = /* @__PURE__ */ new Set(["dashboard", "agent", "leader", "completions", "wrap"]);
var MISSING_SUBCOMMANDS = /* @__PURE__ */ new Set(["import"]);
var BLOCKED_WORDS = /* @__PURE__ */ new Set([...NON_HEADLESS, ...MISSING_SUBCOMMANDS, "login"]);
var PROMPT_FLAGS = /* @__PURE__ */ new Set(["-p", "--single", "--prompt-file", "--prompt-json"]);
function extractPromptRun(args) {
  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (!tok.startsWith("-")) continue;
    const eq = tok.indexOf("=");
    const name = eq >= 0 ? tok.slice(0, eq) : tok;
    if (!PROMPT_FLAGS.has(name)) continue;
    const value = eq >= 0 ? tok.slice(eq + 1) : args[i + 1];
    if (name === "--prompt-file" || name === "--prompt-json") {
      return { prompt: `(${name}${value ? ` ${value}` : ""})` };
    }
    if (value !== void 0) return { prompt: value };
  }
  return void 0;
}

// src/hook.ts
function resolveHookMode(env) {
  const v = env.GROK_BUILD_AUTH_MODE;
  return v === "subscription" || v === "api" ? v : "unknown";
}
function decideHook(mode, deps) {
  if (!deps.grokInstalled()) return { deny: true, reason: GROK_NOT_INSTALLED_MESSAGE };
  if (mode === "subscription") {
    const r = checkAuth("subscription", deps);
    return r.ok ? { deny: false } : { deny: true, reason: r.message };
  }
  return { deny: false };
}
function parseHookPayload(raw) {
  try {
    const j = JSON.parse(raw);
    const toolName = typeof j?.tool_name === "string" ? j.tool_name : void 0;
    const rawArgs = j?.tool_input?.args;
    const args = Array.isArray(rawArgs) ? rawArgs.filter((x) => typeof x === "string") : void 0;
    return { toolName, args };
  } catch {
    return {};
  }
}
function needsAuthGate(payload) {
  if (!payload.toolName?.endsWith("grok_cli")) return true;
  return extractPromptRun(payload.args ?? []) !== void 0;
}
async function runHook(io) {
  try {
    const payload = parseHookPayload(await io.readStdin());
    const decision = needsAuthGate(payload) ? decideHook(resolveHookMode(io.env), io.deps) : io.deps.grokInstalled() ? { deny: false } : { deny: true, reason: GROK_NOT_INSTALLED_MESSAGE };
    if (decision.deny) {
      io.writeStdout(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: decision.reason
          }
        })
      );
    }
  } catch {
  }
}

// src/hook-entry.ts
function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}
runHook({
  readStdin,
  writeStdout: (s) => process.stdout.write(s),
  env: process.env,
  deps: defaultAuthDeps()
}).then(() => process.exit(0)).catch(() => process.exit(0));
