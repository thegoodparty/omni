import swc from 'unplugin-swc'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

// Eval suites are `*.eval.ts`: plain Vitest files that run a real agent and
// grade the result, some with a judge model (`JUDGE_MODEL` plus that
// provider's key). They are NOT part of `npm test` or `verify` — they spend
// model calls — so they live in this config alone, run by `npm run eval`.
const EVAL_FILES = 'src/**/*.eval.ts'

export default defineConfig({
  // SWC, not esbuild: a suite reaches gp-api code that carries NestJS
  // decorator metadata.
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
    // A suite's `define(...)` registers its cases through Vitest's globals.
    globals: true,
    include: [EVAL_FILES],
    // A case runs three attempts, and an attempt can be a real agent run plus
    // one or more model calls. This is a ceiling for a hung test, not a budget.
    testTimeout: 180_000,
    maxWorkers: process.env.CI ? undefined : 4,
  },
})
