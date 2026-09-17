import { vi } from 'vitest'

// election-api is default-deny: M2MAuthGuard rejects every non-@PublicAccess
// request that lacks a valid M2M token. The integration harness boots the real
// app and calls it over HTTP as an authenticated service caller, so stub Clerk's
// networkless verify to accept the harness token (see test-service.ts). Only
// createClerkClient is overridden — the rest of the module (e.g. the ClerkClient
// type) is preserved so type-only imports still resolve. A plain async fn (not a
// vi.fn) keeps the implementation through `clearMocks`.
vi.mock('@clerk/backend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@clerk/backend')>()
  return {
    ...actual,
    createClerkClient: () => ({
      m2m: {
        verify: async () => ({ id: 'test-machine', subject: 'test-machine' }),
      },
    }),
  }
})
