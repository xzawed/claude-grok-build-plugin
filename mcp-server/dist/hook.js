import { createRequire as __createRequire } from 'module'; const require = globalThis.require ?? __createRequire(import.meta.url);

// src/auth.ts
import { existsSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join3 } from "node:path";
import { spawnSync } from "node:child_process";

// src/env.ts
import { homedir } from "node:os";
import { join, delimiter } from "node:path";
function grokBinDir(env) {
  return env.GROK_BIN_DIR && env.GROK_BIN_DIR.length > 0 ? env.GROK_BIN_DIR : join(homedir(), ".grok", "bin");
}
function prependGrokBin(env) {
  const dir = grokBinDir(env);
  const current = env.PATH ?? "";
  const parts = current.split(delimiter).filter(Boolean);
  if (parts.includes(dir)) return { ...env };
  return { ...env, PATH: current ? `${dir}${delimiter}${current}` : dir };
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
  return "0.2.4";
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
      if (process.platform === "win32") {
        const probe = spawnSync("where.exe", ["grok"], {
          env: probeEnv,
          windowsHide: true,
          encoding: "utf8"
        });
        pathLookupOk = probe.status === 0 && Boolean((probe.stdout || "").trim());
      } else {
        const probe = spawnSync("sh", ["-c", "command -v grok"], { env: probeEnv });
        pathLookupOk = probe.status === 0;
      }
      return resolveGrokInstalled({
        platform: process.platform,
        binDir: grokBinDir(probeEnv),
        fileExists: existsSync,
        pathLookupOk
      });
    },
    authFileExists: () => existsSync(join3(homedir2(), ".grok", "auth.json")),
    env
  };
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
async function runHook(io) {
  try {
    await io.readStdin();
    const decision = decideHook(resolveHookMode(io.env), io.deps);
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
