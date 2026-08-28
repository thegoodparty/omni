import dotenv from 'dotenv'
import { readFileSync } from 'fs'
import swc from 'unplugin-swc'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // We disable esbuild and use swc because NestJS relies on
  // decorator metadata that esbuild does not provide.
  esbuild: false,
  plugins: [
    swc.vite(),
    swc.rollup({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { decoratorMetadata: true },
      },
    }),
    tsconfigPaths(),
  ],
  test: {
    // Builds the Postgres schema template once per run so integration suites
    // (useTestService) can clone it instead of replaying every migration.
    globalSetup: [
      '../contracts/scripts/vitest-global-setup.ts',
      './src/test-global-setup.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
    },
    include: ['src/**/*.test.ts'],
    env: dotenv.parse(readFileSync(`${__dirname}/.env.test`)),
    clearMocks: true,
    // Booting a Nest app against a testcontainer can exceed the 5s default.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
