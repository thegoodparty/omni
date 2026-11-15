import { request } from '@playwright/test'
import { clerkSetup } from '@clerk/testing/playwright'
import {
  vercelBypassHeaders,
  vercelBypassStorageState,
} from './src/helpers/vercelBypass.helper'

// Legacy `globalSetup` form (default export), wired via `globalSetup` in
// playwright.config.ts. This runs once before tests regardless of any path
// filter, so we can scope the run to `tests/` (the e2e specs) without skipping
// Clerk auth setup — which a project-dependency setup would skip under a filter.
export default async function globalSetup() {
  await clerkSetup()

  const storageState = vercelBypassStorageState()
  if (storageState) {
    const context = await request.newContext({
      baseURL: process.env.BASE_URL,
      extraHTTPHeaders: {
        ...vercelBypassHeaders(),
        'x-vercel-set-bypass-cookie': 'true',
      },
    })
    // A static file skips the app's middleware, so the saved state holds only
    // Vercel's cookie, not app cookies every context would then share.
    const response = await context.get('/favicon.ico', { maxRedirects: 0 })
    if (response.status() >= 400) {
      throw new Error(
        `Vercel protection bypass failed: GET ${response.url()} returned ${response.status()}`,
      )
    }
    await context.storageState({ path: storageState })
    await context.dispose()
  }
}
