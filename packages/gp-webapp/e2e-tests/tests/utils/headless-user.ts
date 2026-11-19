import {
  apiUrlFor,
  clerkClient,
  requireClerkSecretKey,
  resolveApiBaseUrl,
} from '@goodparty_org/test-users'

// Playwright-free test-user creation, now living in @goodparty_org/test-users so
// the judge provisions users through the same code this suite does. This module
// stays because every spec imports it: it re-exports the shared primitives under
// the names the suite already uses, and keeps the import-time env guards the
// suite has always relied on.

requireClerkSecretKey()
// API_BASE_URL alone is sufficient for all cohort/API operations; BASE_URL is
// only the page-driven path's concern (api-registration.ts guards it there for
// cookie domain). Require at least one so the standalone cohort runbook — which
// sets only API_BASE_URL — doesn't throw at import.
resolveApiBaseUrl()

export {
  applyElectionPreset,
  createTestUser,
  DEFAULT_ELECTION_PRESET,
  DEFAULT_TEST_RACE,
  mintApiToken,
  resolveTestRace,
  withGatewayRetry,
  type CreateTestUserOptions,
  type TestRace,
  type TestUser,
  type TestUserProduct,
} from '@goodparty_org/test-users'

export const apiURL = apiUrlFor()

// A Clerk backend client bound to the dev instance secret, as before.
export const clerkBackend = clerkClient()
