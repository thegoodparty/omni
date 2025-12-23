import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.BASE_URL || 'http://localhost:3500'
const vercelBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html'], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Send Vercel bypass header with every request (for deployment protection)
    ...(vercelBypassSecret && {
      extraHTTPHeaders: {
        'x-vercel-protection-bypass': vercelBypassSecret,
      },
    }),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
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
