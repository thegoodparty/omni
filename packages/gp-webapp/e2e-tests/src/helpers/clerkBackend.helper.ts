import { clerkClient } from '@goodparty_org/test-users'

// A Clerk backend client for the dev instance, built once at import. Specs use
// it for the calls @goodparty_org/test-users has no helper for (invitations, a
// ticket for an existing user) and always wrap them in `clerkThrottle`, since
// they spend the same instance-wide budget every other Clerk call does.
export const clerkBackend = clerkClient()
