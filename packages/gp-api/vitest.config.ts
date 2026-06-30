import dotenv from 'dotenv'
import { readFileSync } from 'fs'
import swc from 'unplugin-swc'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // We have to disable esbuild and use swc because esbuild doesn't support
  // the required decorator metadata features that NestJS uses.
  esbuild: false,
  plugins: [
    swc.vite(),
    swc.rollup({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { decoratorMetadata: true },
      },
    }),
    // We use tsconfigpaths, and therefore we need this.
    tsconfigPaths(),
  ],
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      // Pinned just below the current measured coverage so the suite can only
      // hold or improve, never silently regress. Raise these as coverage grows.
      // Measured 2026-06 (full suite): statements 65.25%, branches 55.08%,
      // functions 61.38%, lines 74.21%.
      thresholds: {
        statements: 65,
        branches: 55,
        functions: 61,
        lines: 74,
      },
    },
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    env: dotenv.parse(readFileSync(`${__dirname}/.env.test`)),
    clearMocks: true,
  },
})
