import { defineConfig } from 'vitest/config'

// Live verification runs: real registry, real pnpm, real filesystem. Separated
// from `pnpm test` so the unit suite stays offline and fast — these take
// minutes and fail when the network does, which is the wrong signal to mix
// into a routine test run.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.e2e.ts'],
    testTimeout: 240_000,
    hookTimeout: 60_000,
    server: {
      deps: { inline: [/@harness-ai\/contracts/] },
    },
  },
})
