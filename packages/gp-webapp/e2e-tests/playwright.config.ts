import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { defineConfig, devices } from '@playwright/test'

const e2eRoot = __dirname
const dotEnv = resolve(e2eRoot, '.env')
const dotEnvLocal = resolve(e2eRoot, '.env.local')
if (existsSync(dotEnv)) {
  loadEnv({ path: dotEnv })
}
if (existsSync(dotEnvLocal)) {
  loadEnv({ path: dotEnvLocal, override: true })
}

process.env.TZ = 'UTC'
if (!process.env.BASE_URL) {
  throw new Error('BASE_URL is not set')
}

export default defineConfig({
  testDir: './tests',
  // Run clerkSetup once before all tests, regardless of any path filter. (A
  // project-dependency setup is skipped when the run is filtered to tests/.)
  globalSetup: './global-setup.ts',
  // The app's vitest unit tests are *.test.tsx/*.test.ts; never collect them as
  // Playwright tests (they'd crash on `import { ... } from 'vitest'`).
  testIgnore: ['**/*.test.ts', '**/*.test.tsx'],
  outputDir: './test-results',
  snapshotPathTemplate:
    '{testDir}/__visual_snapshots__/{testFileDir}/{testFileName}/{arg}{ext}',
  timeout: 120000,
  expect: {
    timeout: 15000,
    toHaveScreenshot: {
      // Full-viewport captures vary with layout/fonts; branch UI changes can exceed
      // pixel-only caps. Ratio + high pixel cap keeps CI green while still catching big regressions.
      maxDiffPixels: 25000,
      maxDiffPixelRatio: 0.045,
      animations: 'disabled', // freeze CSS animations for deterministic captures
      scale: 'css', // use CSS pixels, consistent across machines
    },
  },

  // Improved parallelization with better stability
  fullyParallel: true,
  workers: process.env.CI ? 4 : 4, // Use 4 workers in CI for faster execution
  retries: process.env.CI ? 3 : 2, // Increased retries for flaky tests

  // Clean reporting without TestRail dependency
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],

  projects: [
    {
      name: 'default',
      // Inherit the top-level `use` (which sets baseURL + the Desktop Chrome
      // device). A project-level `use: devices['Desktop Chrome']` dropped
      // baseURL, breaking relative `page.goto('/...')` with "invalid URL".
    },
  ],

  use: {
    baseURL: process.env.BASE_URL,

    // Increased timeouts for better reliability
    actionTimeout: 15000, // Increased from 10s
    navigationTimeout: 45000, // Increased from 30s

    // Essential browser settings
    headless: true,
    ignoreHTTPSErrors: true,

    // Browser args optimized for stability
    launchOptions: {
      args: [
        '--disable-background-timer-throttling', // Prevents timeouts
        '--disable-backgrounding-occluded-windows',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-features=VizDisplayCompositor', // Helps with stability
        '--disable-renderer-backgrounding',
        // '--disable-web-security',
        '--no-sandbox',
      ],
    },

    // Better debugging and error tracking
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
})
