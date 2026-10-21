import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    // Mirrors tsconfig's `@/*` -> repo-root alias. Set here rather than via
    // vite-tsconfig-paths so this package needs no extra dependency for it.
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'node',
    globals: true,
    exclude: ['node_modules/**', '.next/**'],
  },
})
