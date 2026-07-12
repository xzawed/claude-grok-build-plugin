import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { AuthMode, AuthCheckResult } from './types.js';

export interface AuthDeps {
  grokInstalled: () => boolean;
  authFileExists: () => boolean;
  env: NodeJS.ProcessEnv;
}

export function checkAuth(mode: AuthMode, deps: AuthDeps): AuthCheckResult {
  if (!deps.grokInstalled()) {
    return {
      ok: false, mode, reason: 'grok_not_installed',
      message: 'Grok Build CLI를 PATH에서 찾을 수 없습니다. 미설치면 `curl -fsSL https://x.ai/cli/install.sh | bash`로 설치하고, 이미 설치했다면 grok이 PATH에 포함된 터미널에서 Claude Code를 실행하세요.',
    };
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
      const probe = process.platform === 'win32'
        ? spawnSync('where', ['grok'])
        : spawnSync('sh', ['-c', 'command -v grok']);
      return probe.status === 0;
    },
    authFileExists: () => existsSync(join(homedir(), '.grok', 'auth.json')),
    env,
  };
}
