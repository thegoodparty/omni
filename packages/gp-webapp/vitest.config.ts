import { sync as glob } from 'fast-glob'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

const EXCLUDE = ['e2e-tests/**', 'node_modules/**']

// Most test files run in a vm pool: each file still gets a fresh jsdom and a
// fresh module graph, but inside a long-lived worker, so it no longer pays for
// a new process, a new jsdom import and a cold load of every dependency. In a
// vm context the global object is jsdom's own window, whose location and
// document are non-configurable, the way they are in a browser. Files that
// swap one of those out need the default pool, where jsdom's properties are
// copied onto Node's global and can be redefined.
const REPLACES_WINDOW_GLOBAL =
  /(?:defineProperty\(\s*(?:window|globalThis|global)\s*,|stubGlobal\()\s*['"](?:location|document)['"]/
const replacesWindowGlobal = glob(configDefaults.include, {
  cwd: __dirname,
  ignore: EXCLUDE,
}).filter((file) =>
  REPLACES_WINDOW_GLOBAL.test(readFileSync(resolve(__dirname, file), 'utf8')),
)

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom',
    // Several suites deliberately wait up to 10s for a debounced count or a
    // streamed response to settle. Vitest's 5s default silently capped those
    // waits, so the test aborted before its own tolerance could apply — green
    // on CI runners, timing out on slower or busier developer machines.
    testTimeout: 20_000,
    setupFiles: ['./vitest.vm-globals.ts', './vitest.setup.ts'],
    // Builds contracts if its gitignored dist is missing or stale. It lives
    // here rather than on the `test` script because `npx vitest run <path>`
    // bypasses package.json, and that is the invocation that strands people.
    globalSetup: ['../contracts/scripts/vitest-global-setup.ts'],
    globals: true,
    exclude: EXCLUDE,
    // A vm worker keeps some memory from every context it has run, and
    // vitest's default recycle point (a share of system RAM) sits above Node's
    // ~4GB heap ceiling, so a worker dies of OOM before it is ever recycled.
    // 1GB of heap is the fastest limit measured locally. Vitest reads this
    // from the root config only; set inside a project it is ignored.
    vmMemoryLimit: '1GB',
    // Vitest leaves one core free by default, but a flow test spends about a
    // quarter of its time waiting on real timers, so on a 4-core CI runner the
    // fourth worker is mostly filling idle time rather than competing for it.
    maxWorkers: process.env.CI ? '100%' : undefined,
    projects: [
      {
        extends: true,
        test: {
          name: 'vm',
          pool: 'vmForks',
          exclude: [...EXCLUDE, ...replacesWindowGlobal],
        },
      },
      {
        extends: true,
        test: {
          name: 'forks',
          include: replacesWindowGlobal,
        },
      },
    ],
  },
})
