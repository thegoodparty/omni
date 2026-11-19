import { readFileSync } from 'node:fs'
import { resolve } from 'path'
import { sync as glob } from 'fast-glob'
import swc from 'unplugin-swc'
import tsconfigPaths from 'vite-tsconfig-paths'
import { configDefaults, defineConfig } from 'vitest/config'

// Eval suites are `*.eval.ts`: plain Vitest files that run a real agent and
// grade the result, some with a judge model (`JUDGE_MODEL` plus that
// provider's key). They are NOT part of `npm test` or `verify` — they spend
// model calls — so they live in this config alone, run by `npm run eval`.
const EVAL_FILES = 'src/**/*.eval.ts'

// The pairwise judge runner (`packages/judge/src/run.ts`) globs the same
// pattern and owns the suites it finds there. One of those registers no
// Vitest tests, so Vitest would fail its file with "no test suite found".
// Picking the files by what they define, rather than by a listed set of names,
// means the pairwise suites that move onto Vitest later start running here on
// their own, and nothing has to be remembered.
const PAIRWISE_SUITE = /\bdefinePairwiseAgentEvalSuite\b/
const pairwiseFiles = glob(EVAL_FILES, { cwd: __dirname }).filter((file) =>
  PAIRWISE_SUITE.test(readFileSync(resolve(__dirname, file), 'utf8')),
)

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
    exclude: [...configDefaults.exclude, ...pairwiseFiles],
    // A case runs three attempts, and an attempt can be a real agent run plus
    // one or more model calls. This is a ceiling for a hung test, not a budget.
    testTimeout: 180_000,
    maxWorkers: process.env.CI ? undefined : 4,
  },
})
