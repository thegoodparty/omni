import { defineConfig } from '@playwright/test'

// Consumed only by `playwright merge-reports` in the E2E summary CI job, which
// combines the per-shard blob reports into the same outputs a single run
// produced: playwright-report/ (HTML, published to S3) and
// test-results/results.json (parsed for the PR comment). Kept separate from
// playwright.config.ts on purpose — that config throws when BASE_URL is unset
// and runs globalSetup (clerkSetup), neither of which is wanted in a merge job
// that never launches a browser.
export default defineConfig({
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
})
