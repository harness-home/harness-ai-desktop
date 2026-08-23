import { defineConfig } from 'vitest/config'

// Unit tests for the shell's pure logic (parsers, filters). Anything that needs
// a running Electron or a live runtime is covered by the scripts/ smoke and
// acceptance runs instead.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    server: {
      // @harness-ai/contracts is a link: TypeScript source package, so it has
      // to be transformed rather than treated as an external dependency.
      deps: { inline: [/@harness-ai\/contracts/] },
    },
  },
})
