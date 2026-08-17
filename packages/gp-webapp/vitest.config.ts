import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom',
    // Several suites deliberately wait up to 10s for a debounced count or a
    // streamed response to settle. Vitest's 5s default silently capped those
    // waits, so the test aborted before its own tolerance could apply — green
    // on CI runners, timing out on slower or busier developer machines.
    testTimeout: 20_000,
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    exclude: ['e2e-tests/**', 'node_modules/**'],
  },
})
