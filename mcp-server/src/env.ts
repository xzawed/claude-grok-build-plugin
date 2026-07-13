import { homedir } from 'node:os';
import { join, delimiter } from 'node:path';
import type { AuthMode } from './types.js';

const API_KEY_VARS = ['XAI_API_KEY', 'GROK_CODE_XAI_API_KEY'] as const;

// grok's install.sh puts the binary in $GROK_BIN_DIR (default $HOME/.grok/bin) and adds
// that dir to PATH in shell profiles. A GUI/Dock-launched Claude Code doesn't source those
// profiles, so its PATH — inherited by the MCP server and hook subprocesses — may omit it.
export function grokBinDir(env: NodeJS.ProcessEnv): string {
  return env.GROK_BIN_DIR && env.GROK_BIN_DIR.length > 0
    ? env.GROK_BIN_DIR
    : join(homedir(), '.grok', 'bin');
}

// Returns a copy of env with the grok bin dir prepended to PATH so `grok` is discoverable
// even under a minimal PATH. Idempotent (skips if already present); does not mutate input.
export function prependGrokBin(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const dir = grokBinDir(env);
  const current = env.PATH ?? '';
  const parts = current.split(delimiter).filter(Boolean);
  if (parts.includes(dir)) return { ...env };
  return { ...env, PATH: current ? `${dir}${delimiter}${current}` : dir };
}

export function buildGrokEnv(
  mode: AuthMode,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const copy: NodeJS.ProcessEnv = { ...env };
  if (mode === 'subscription') {
    for (const key of API_KEY_VARS) delete copy[key];
  }
  return prependGrokBin(copy);
}
