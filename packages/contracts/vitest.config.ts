import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // The package that owns the Node guard was the one package not running
    // it. Its own entry rather than the shared one — see the comment there.
    globalSetup: ['./scripts/vitest-node-guard.ts'],
  },
})
