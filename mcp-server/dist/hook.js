import { createRequire as __createRequire } from 'module'; const require = globalThis.require ?? __createRequire(import.meta.url);

// src/auth.ts
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
var GROK_NOT_INSTALLED_MESSAGE = "Grok Build CLI\uB97C PATH\uC5D0\uC11C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uBBF8\uC124\uCE58\uBA74 `curl -fsSL https://x.ai/cli/install.sh | bash`\uB85C \uC124\uCE58\uD558\uACE0, \uC774\uBBF8 \uC124\uCE58\uD588\uB2E4\uBA74 grok\uC774 PATH\uC5D0 \uD3EC\uD568\uB41C \uD130\uBBF8\uB110\uC5D0\uC11C Claude Code\uB97C \uC2E4\uD589\uD558\uC138\uC694.";
function checkAuth(mode, deps) {
  if (!deps.grokInstalled()) {
    return { ok: false, mode, reason: "grok_not_installed", message: GROK_NOT_INSTALLED_MESSAGE };
  }
  if (mode === "subscription") {
    if (!deps.authFileExists()) {
      return {
        ok: false,
        mode,
        reason: "not_logged_in",
        message: "\uAD6C\uB3C5 \uB85C\uADF8\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4. \uD130\uBBF8\uB110\uC5D0\uC11C `grok login`\uC744 \uC2E4\uD589\uD55C \uB4A4 \uB2E4\uC2DC \uC2DC\uB3C4\uD558\uC138\uC694."
      };
    }
    return { ok: true, mode, message: "\uAD6C\uB3C5 \uC138\uC158 \uC778\uC99D \uC900\uBE44\uB428." };
  }
  const hasKey = Boolean(deps.env.XAI_API_KEY || deps.env.GROK_CODE_XAI_API_KEY);
  if (!hasKey) {
    return {
      ok: false,
      mode,
      reason: "no_api_key",
      message: "API \uBAA8\uB4DC\uC785\uB2C8\uB2E4. `XAI_API_KEY` \uD658\uACBD\uBCC0\uC218\uB97C \uC124\uC815\uD55C \uB4A4 \uB2E4\uC2DC \uC2DC\uB3C4\uD558\uC138\uC694."
    };
  }
  return { ok: true, mode, message: "API \uD0A4 \uC778\uC99D \uC900\uBE44\uB428." };
}
function defaultAuthDeps(env = process.env) {
  return {
    grokInstalled: () => {
      const probe = process.platform === "win32" ? spawnSync("where", ["grok"]) : spawnSync("sh", ["-c", "command -v grok"]);
      return probe.status === 0;
    },
    authFileExists: () => existsSync(join(homedir(), ".grok", "auth.json")),
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
