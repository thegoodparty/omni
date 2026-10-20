import { createClerkClient } from '@clerk/backend'
import { clerkSetup } from '@clerk/testing/playwright'

// Clerk development instances stop creating users at 50,000. On Oct 1, 2026
// the test instance hit that cap and every test user creation failed with
// `user_quota_exceeded`, which surfaced as hundreds of unrelated-looking test
// failures. Checking the count once here turns that into one clear error.
const CLERK_DEV_USER_LIMIT = 50_000
const FAIL_BELOW_REMAINING = 1_000
const WARN_BELOW_REMAINING = 10_000

const checkClerkUserQuota = async () => {
  const secretKey = process.env.CLERK_SECRET_KEY
  if (!secretKey?.startsWith('sk_test_')) {
    return
  }
  const count = await createClerkClient({ secretKey }).users.getCount()
  const remaining = CLERK_DEV_USER_LIMIT - count
  const summary = `Clerk test instance has ${count} of ${CLERK_DEV_USER_LIMIT} users. gp-api's sweepTestUsers job removes test users older than 3 hours; check that it is running on dev.`
  if (remaining < FAIL_BELOW_REMAINING) {
    throw new Error(`${summary} Not enough room to create test users.`)
  }
  if (remaining < WARN_BELOW_REMAINING) {
    console.warn(`::warning::${summary}`)
  }
}

// Legacy `globalSetup` form (default export), wired via `globalSetup` in
// playwright.config.ts. This runs once before tests regardless of any path
// filter, so we can scope the run to `tests/` (the e2e specs) without skipping
// Clerk auth setup — which a project-dependency setup would skip under a filter.
export default async function globalSetup() {
  await clerkSetup()
  await checkClerkUserQuota()
}
