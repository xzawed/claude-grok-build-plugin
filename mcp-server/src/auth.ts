import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { grokBinDir, prependGrokBin } from './env.js';
import type { AuthMode, AuthCheckResult } from './types.js';

export interface AuthDeps {
  grokInstalled: () => boolean;
  authFileExists: () => boolean;
  env: NodeJS.ProcessEnv;
}

/** Platform-aware install hint (shared by server + PreToolUse hook). */
export function grokNotInstalledMessage(platform: NodeJS.Platform = process.platform): string {
  const install = platform === 'win32'
    ? 'PowerShell: `irm https://x.ai/cli/install.ps1 | iex`'
    : '`curl -fsSL https://x.ai/cli/install.sh | bash`';
  return (
    'Grok Build CLI를 PATH에서 찾을 수 없습니다. 미설치면 ' +
    install +
    ' 로 설치하고, 이미 설치했다면 grok이 PATH에 포함된 터미널에서 Claude Code를 실행하세요. ' +
    '(Windows: 설치 후 새 터미널을 열거나 Claude Code를 재시작하세요.)'
  );
}

// Evaluated at load for the running OS — hook + server share this string.
export const GROK_NOT_INSTALLED_MESSAGE = grokNotInstalledMessage();

/** Binary names under the grok install dir (Windows includes .exe/.cmd). */
export function grokBinNames(platform: NodeJS.Platform = process.platform): string[] {
  return platform === 'win32'
    ? ['grok.exe', 'grok.cmd', 'grok.bat', 'grok']
    : ['grok'];
}

/**
 * Pure-ish probe: PATH command lookup result and/or files under grok bin dir.
 * Used by defaultAuthDeps and unit-tested without spawning.
 */
export function resolveGrokInstalled(opts: {
  platform: NodeJS.Platform;
  binDir: string;
  fileExists: (p: string) => boolean;
  /** True when `where grok` / `command -v grok` succeeded. */
  pathLookupOk: boolean;
}): boolean {
  if (opts.pathLookupOk) return true;
  return grokBinNames(opts.platform).some((name) => opts.fileExists(join(opts.binDir, name)));
}

export function checkAuth(mode: AuthMode, deps: AuthDeps): AuthCheckResult {
  if (!deps.grokInstalled()) {
    return { ok: false, mode, reason: 'grok_not_installed', message: GROK_NOT_INSTALLED_MESSAGE };
  }
  if (mode === 'subscription') {
    if (!deps.authFileExists()) {
      return {
        ok: false, mode, reason: 'not_logged_in',
        message: '구독 로그인이 필요합니다. 터미널에서 `grok login`을 실행한 뒤 다시 시도하세요.',
      };
    }
    return { ok: true, mode, message: '구독 세션 인증 준비됨.' };
  }
  const hasKey = Boolean(deps.env.XAI_API_KEY || deps.env.GROK_CODE_XAI_API_KEY);
  if (!hasKey) {
    return {
      ok: false, mode, reason: 'no_api_key',
      message: 'API 모드입니다. `XAI_API_KEY` 환경변수를 설정한 뒤 다시 시도하세요.',
    };
  }
  return { ok: true, mode, message: 'API 키 인증 준비됨.' };
}

export function defaultAuthDeps(env: NodeJS.ProcessEnv = process.env): AuthDeps {
  return {
    grokInstalled: () => {
      // Probe with grok's install dir prepended to PATH so a GUI/Dock launch (minimal
      // PATH) still finds grok — matching the spawn env in buildGrokEnv.
      const probeEnv = prependGrokBin(env);
      let pathLookupOk = false;
      if (process.platform === 'win32') {
        // where.exe resolves .exe/.cmd/.bat; windowsHide avoids flash of console window.
        const probe = spawnSync('where.exe', ['grok'], {
          env: probeEnv, windowsHide: true, encoding: 'utf8',
        });
        pathLookupOk = probe.status === 0 && Boolean((probe.stdout || '').trim());
      } else {
        const probe = spawnSync('sh', ['-c', 'command -v grok'], { env: probeEnv });
        pathLookupOk = probe.status === 0;
      }
      // Fallback: install dir file check (PATH still broken / empty where output).
      return resolveGrokInstalled({
        platform: process.platform,
        binDir: grokBinDir(probeEnv),
        fileExists: existsSync,
        pathLookupOk,
      });
    },
    authFileExists: () => existsSync(join(homedir(), '.grok', 'auth.json')),
    env,
  };
}
