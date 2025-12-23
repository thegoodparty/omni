import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.BASE_URL || 'http://localhost:3500'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html'], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  // Only start the local dev server when not using an external BASE_URL
  ...(process.env.BASE_URL
    ? {}
    : {
        webServer: {
          command: 'NEXT_PUBLIC_E2E_TESTING=true npm run dev -w @gp-admin/web',
          url: 'http://localhost:3500',
          reuseExistingServer: true,
          timeout: 120000,
        },
      }),
})
