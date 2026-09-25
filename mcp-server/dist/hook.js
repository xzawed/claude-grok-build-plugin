import { createRequire as __createRequire } from 'module'; const require = globalThis.require ?? __createRequire(import.meta.url);

// src/hook.ts
import { isAbsolute } from "node:path";

// src/auth.ts
import { existsSync } from "node:fs";
import { join as join3 } from "node:path";
import { spawnSync } from "node:child_process";

// src/env.ts
import { homedir } from "node:os";
import { join, delimiter, posix, win32 } from "node:path";
var API_KEY_VARS = ["XAI_API_KEY", "GROK_CODE_XAI_API_KEY"];
var API_KEY_VARS_LOWER = new Set(API_KEY_VARS.map((k) => k.toLowerCase()));
function grokHome(env, platform = process.platform) {
  const raw = env.GROK_HOME;
  if (!raw || raw.length === 0) return join(homedir(), ".grok");
  return platform === "win32" ? win32DirAsOpened(raw) : raw;
}
function dropLoneTrailingDot(segment) {
  return segment.length > 1 && segment.endsWith(".") && !segment.endsWith("..") ? segment.slice(0, -1) : segment;
}
function win32DirAsOpened(dir) {
  if (dir.startsWith("\\\\?\\")) return dir;
  const rest = dir.slice(win32.parse(dir).root.length);
  if (!rest.split(/[\\/]/).some((s) => dropLoneTrailingDot(s) !== s)) return dir;
  const normalized = win32.normalize(dir);
  const { root } = win32.parse(normalized);
  return root + normalized.slice(root.length).split("\\").map(dropLoneTrailingDot).join("\\");
}
function win32FolderAsEntered(dir) {
  if (dir.startsWith("\\\\?\\")) return dir;
  const endsInSeparator = dir.endsWith("\\") || dir.endsWith("/");
  const resolved = win32.resolve(dir);
  if (endsInSeparator) return win32DirAsOpened(resolved);
  let end = resolved.length;
  while (end > 0 && (resolved[end - 1] === " " || resolved[end - 1] === ".")) end -= 1;
  return win32DirAsOpened(resolved.slice(0, end));
}
function grokHomeFor(env, baseDir, platform = process.platform) {
  const raw = env.GROK_HOME;
  if (raw && raw.length > 0) {
    if (platform !== "win32") return grokHomeDependsOnFolder(raw, platform) ? posix.resolve(baseDir, raw) : raw;
    if (!grokHomeDependsOnFolder(raw, platform)) return win32DirAsOpened(raw);
    return win32DirAsOpened(win32.resolve(win32FolderAsEntered(baseDir), raw));
  }
  return join(homedir(), ".grok");
}
function grokHomeDependsOnFolder(raw, platform = process.platform) {
  if (platform !== "win32") return !posix.isAbsolute(raw);
  if (!win32.isAbsolute(raw)) return true;
  const isSep = (c) => c === "\\" || c === "/";
  return isSep(raw[0]) && !isSep(raw[1]);
}
function grokHomeNote(env, baseDir, platform = process.platform) {
  const raw = env.GROK_HOME;
  if (!raw) return void 0;
  const notes = [];
  const trimmed = raw.trim();
  if (trimmed === "") {
    notes.push(`GROK_HOME\uC774 \uACF5\uBC31 \uBB38\uC790 ${raw.length}\uC790\uBFD0\uC785\uB2C8\uB2E4. grok\uB3C4 \uC774 \uAC12\uC73C\uB85C\uB294 \uB85C\uADF8\uC778 \uC0C1\uD0DC\uAC00 \uB418\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4 \u2014 \uAE30\uBCF8 \uD648(~/.grok)\uC744 \uC4F0\uB824\uB358 \uAC83\uC774\uB77C\uBA74 GROK_HOME \uBCC0\uC218\uB97C \uC9C0\uC6B0\uC138\uC694.` + (platform === "win32" ? " (cmd\uC758 `set GROK_HOME= && \u2026`\uB294 `&&` \uC55E\uC758 \uACF5\uBC31 \uD55C \uCE78\uC744 \uAC12\uC73C\uB85C \uB123\uC2B5\uB2C8\uB2E4.)" : ""));
    return notes[0];
  }
  if (trimmed !== raw) {
    const lead = raw.length - raw.trimStart().length;
    const trail = raw.length - raw.trimEnd().length;
    const where = lead > 0 && trail > 0 ? `\uC55E ${lead}\uC790\xB7\uB05D ${trail}\uC790` : lead > 0 ? `\uC55E ${lead}\uC790` : `\uB05D ${trail}\uC790`;
    notes.push(`GROK_HOME('${raw}')\uC758 ${where}\uAC00 \uACF5\uBC31 \uBB38\uC790\uC785\uB2C8\uB2E4. grok\uC740 \uADF8 \uBB38\uC790\uAE4C\uC9C0 \uACBD\uB85C\uB85C \uC4F0\uBBC0\uB85C '${trimmed}'\uC5D0 \uB85C\uADF8\uC778\uD574 \uC788\uC5B4\uB3C4 grok\uB3C4 \uC774 \uD655\uC778\uB3C4 \uADF8 \uC138\uC158\uC744 \uCC3E\uC9C0 \uBABB\uD569\uB2C8\uB2E4 \u2014 \`grok login\`\uC744 \uB2E4\uC2DC \uD558\uAE30 \uC804\uC5D0 GROK_HOME\uC744 '${trimmed}'\uB85C \uACE0\uCE58\uC138\uC694.` + (platform === "win32" ? " (cmd\uC758 `set GROK_HOME=C:\\x && \u2026`\uB294 `&&` \uC55E\uC758 \uACF5\uBC31\uAE4C\uC9C0 \uAC12\uC5D0 \uB123\uC2B5\uB2C8\uB2E4.)" : ""));
  }
  if (baseDir !== void 0 && grokHomeDependsOnFolder(raw, platform) && grokHomeDependsOnFolder(trimmed, platform)) {
    notes.push(`GROK_HOME('${raw}')\uC740 \uC0C1\uB300 \uACBD\uB85C\uB77C(Windows\uC5D0\uC11C\uB294 \\grok\uCC98\uB7FC \uB4DC\uB77C\uC774\uBE0C \uC5C6\uC774 \uB8E8\uD2B8\uBD80\uD130 \uC4F4 \uACBD\uB85C\uB3C4) grok\uC774 \uC2E4\uD589\uB418\uB294 \uC791\uC5C5 \uD3F4\uB354\uC5D0 \uB530\uB77C \uB2EC\uB77C\uC9C0\uACE0, ~\uB3C4 \uD480\uB9AC\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uC774 \uB2F5\uC740 ${grokHomeFor(env, baseDir, platform)} \uAE30\uC900\uC785\uB2C8\uB2E4. \uC704\uC784\uC740 \uAC01\uC790\uC758 \uC791\uC5C5 \uD3F4\uB354 \uAE30\uC900\uC73C\uB85C \uB2E4\uC2DC \uD655\uC778\uD569\uB2C8\uB2E4 \u2014 \uD3F4\uB354\uB9C8\uB2E4 \uB2E4\uB978 \uD648\uC744 \uC758\uB3C4\uD55C \uAC8C \uC544\uB2C8\uB77C\uBA74 GROK_HOME\uC744 \uC808\uB300 \uACBD\uB85C(Windows\uB294 \uB4DC\uB77C\uC774\uBE0C \uBB38\uC790\uBD80\uD130)\uB85C \uC124\uC815\uD558\uC138\uC694.`);
  }
  return notes.length > 0 ? notes.join(" ") : void 0;
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
  return "0.2.35";
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
function authFilePath(env, baseDir) {
  return join3(baseDir === void 0 ? grokHome(env) : grokHomeFor(env, baseDir), "auth.json");
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
function checkAuth(mode, deps, baseDir) {
  const base = baseAuthFields(mode);
  if (!deps.grokInstalled()) {
    return { ok: false, ...base, reason: "grok_not_installed", message: GROK_NOT_INSTALLED_MESSAGE };
  }
  if (mode === "subscription") {
    if (!deps.authFileExists(baseDir)) {
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
  const message = deps.authFileExists(baseDir) ? "API \uD0A4\uAC00 \uC124\uC815\uB3FC \uC788\uC2B5\uB2C8\uB2E4 \u2014 \uC720\uD6A8\uC131\uC740 \uAC80\uC99D\uD558\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4. \uAD6C\uB3C5 \uC138\uC158\uB3C4 \uC788\uC73C\uBBC0\uB85C, \uD0A4\uAC00 \uAC70\uBD80\uB418\uBA74 grok\uC774 \uAD6C\uB3C5 \uC138\uC158\uC73C\uB85C \uB118\uC5B4\uAC00 \uC2E4\uC81C\uB85C\uB294 \uC885\uB7C9\uC81C\uB85C \uCCAD\uAD6C\uB418\uC9C0 \uC54A\uC744 \uC218 \uC788\uC2B5\uB2C8\uB2E4." : "API \uD0A4\uAC00 \uC124\uC815\uB3FC \uC788\uC2B5\uB2C8\uB2E4 \u2014 \uC720\uD6A8\uC131\uC740 \uAC80\uC99D\uD558\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.";
  return { ok: true, ...base, message };
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
    authFileExists: (baseDir) => existsSync(authFilePath(env, baseDir)),
    env
  };
}

// src/config.ts
function resolveAuthMode(env = process.env) {
  const raw = env.GROK_BUILD_AUTH_MODE?.trim().toLowerCase();
  if (raw === void 0 || raw === "") return "subscription";
  if (raw === "subscription" || raw === "api") return raw;
  throw new Error(
    `Invalid GROK_BUILD_AUTH_MODE: "${env.GROK_BUILD_AUTH_MODE}". Expected "subscription" or "api".`
  );
}

// src/prompt-flags.ts
var PROMPT_FLAGS = /* @__PURE__ */ new Set(["-p", "--single", "--prompt-file", "--prompt-json"]);
var BOOLEAN_SHORTS = /* @__PURE__ */ new Set(["c", "v", "h"]);
var SHORT_TOKEN = /^-[A-Za-z]/;
var LEADING_LETTERS = /^[A-Za-z]+/;
function extractPromptRun(args) {
  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (!tok.startsWith("-")) continue;
    if (!tok.startsWith("--") && SHORT_TOKEN.test(tok)) {
      const chars = tok.slice(1);
      let at = 0;
      while (at < chars.length && BOOLEAN_SHORTS.has(chars[at])) at += 1;
      if (chars[at] !== "p") continue;
      const rest = chars.slice(at + 1);
      const attached = rest.startsWith("=") ? rest.slice(1) : rest;
      const value2 = rest.length > 0 ? attached : args[i + 1];
      if (value2 !== void 0) return { prompt: value2 };
      continue;
    }
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
function mayRunTurn(args) {
  if (extractPromptRun(args) !== void 0) return true;
  return args.some((t) => {
    if (t.startsWith("--") || !SHORT_TOKEN.test(t)) return false;
    return (LEADING_LETTERS.exec(t.slice(1))?.[0] ?? "").includes("p");
  });
}

// src/hook.ts
function resolveHookMode(env) {
  try {
    return resolveAuthMode(env);
  } catch {
    return "unknown";
  }
}
function decideHook(mode, deps, baseDir, mayDefer = true) {
  if (!deps.grokInstalled()) return { deny: true, reason: GROK_NOT_INSTALLED_MESSAGE };
  if (mode === "subscription") {
    const home = deps.env.GROK_HOME;
    if (mayDefer && home && grokHomeDependsOnFolder(home) && baseDir === void 0) return { deny: false };
    const r = checkAuth("subscription", deps, baseDir);
    if (r.ok) return { deny: false };
    const note = grokHomeNote(deps.env, baseDir);
    return { deny: true, reason: note ? `${r.message} ${note}` : r.message };
  }
  return { deny: false };
}
function parseHookPayload(raw) {
  try {
    const j = JSON.parse(raw);
    const toolName = typeof j?.tool_name === "string" ? j.tool_name : void 0;
    const rawArgs = j?.tool_input?.args;
    const args = Array.isArray(rawArgs) ? rawArgs.filter((x) => typeof x === "string") : void 0;
    const cwd = typeof j?.tool_input?.cwd === "string" ? j.tool_input.cwd : void 0;
    const worktree = j?.tool_input?.worktree === true;
    return { toolName, args, cwd, worktree };
  } catch {
    return {};
  }
}
function runFolder(payload) {
  if (payload.worktree) return void 0;
  if (payload.args?.some((t) => t === "--cwd" || t.startsWith("--cwd="))) return void 0;
  return payload.cwd !== void 0 && isAbsolute(payload.cwd) ? payload.cwd : void 0;
}
function needsAuthGate(payload) {
  if (!payload.toolName?.endsWith("grok_cli")) return true;
  return mayRunTurn(payload.args ?? []);
}
async function runHook(io) {
  try {
    const payload = parseHookPayload(await io.readStdin());
    const decision = needsAuthGate(payload) ? decideHook(resolveHookMode(io.env), io.deps, runFolder(payload), payload.toolName !== void 0) : io.deps.grokInstalled() ? { deny: false } : { deny: true, reason: GROK_NOT_INSTALLED_MESSAGE };
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
