import { createClerkClient, ClerkClient } from '@clerk/backend'

export const CLERK_CLIENT_PROVIDER_TOKEN = 'ELECTION_API_CLERK_CLIENT'

// Keys are optional at construction so local dev / tests that never exercise
// auth can still boot. They are required at request time only when
// ELECTION_API_AUTH_ENFORCED is on (see M2MAuthGuard).
export const ClerkClientProvider = {
  provide: CLERK_CLIENT_PROVIDER_TOKEN,
  useFactory: (): ClerkClient =>
    createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY,
      publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    }),
}
