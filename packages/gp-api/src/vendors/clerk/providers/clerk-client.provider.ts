import { createClerkClient } from '@clerk/backend'

const { CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY } = process.env

if (!CLERK_PUBLISHABLE_KEY || !CLERK_SECRET_KEY) {
  throw new Error(
    'CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY must be set! Run ' +
      '`npm run setup`',
  )
}

export const CLERK_CLIENT_PROVIDER_TOKEN = 'ClerkClient'

// CLERK_JWT_KEY (the instance PEM public key) makes M2M JWT verification
// networkless. Without it the SDK refetches Clerk's JWKS every 5 minutes on
// the request path, and a slow fetch past clerkCall's 2s timeout 403s the
// request.
export const ClerkClientProvider = {
  provide: CLERK_CLIENT_PROVIDER_TOKEN,
  useFactory: () =>
    createClerkClient({
      publishableKey: CLERK_PUBLISHABLE_KEY,
      secretKey: CLERK_SECRET_KEY,
      jwtKey: process.env.CLERK_JWT_KEY || undefined,
    }),
}
