import { defineConfig } from 'vitest/config';

// `pool: 'forks'` is vitest 4's default, pinned because test/delegate.test.ts relies on it: that file writes
// process.env.USERPROFILE/HOME so `os.homedir()` names no real grok home, and only a forked worker's homedir follows
// such a write — a thread worker keeps the process's own (pre-merge review of v0.2.51). The file also checks it at start.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], pool: 'forks' } });
