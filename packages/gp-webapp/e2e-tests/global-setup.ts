import { clerkSetup } from '@clerk/testing/playwright'

// Legacy `globalSetup` form (default export), wired via `globalSetup` in
// playwright.config.ts. This runs once before tests regardless of any path
// filter, so we can scope the run to `tests/` (the e2e specs) without skipping
// Clerk auth setup — which a project-dependency setup would skip under a filter.
export default async function globalSetup() {
  await clerkSetup()
}
