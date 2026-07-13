// Executable entry for the pre-delegate-auth-check PreToolUse hook.
// Bundled by build.mjs into dist/hook.js and invoked as
//   node "${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/hook.js"
// from hooks/hooks.json. Pure decision logic lives in hook.ts (unit-tested); this
// file is the thin process-boundary glue (real stdin/stdout/env/deps), kept separate
// so importing hook.ts in tests has no side effects.
import { runHook } from './hook.js';
import { defaultAuthDeps } from './auth.js';

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

// Always exit 0: a "deny" is communicated via the hookSpecificOutput JSON on stdout,
// not via exit code. Any fault fails open (runHook swallows errors → no output → allow).
runHook({
  readStdin,
  writeStdout: (s) => process.stdout.write(s),
  env: process.env,
  deps: defaultAuthDeps(),
})
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
