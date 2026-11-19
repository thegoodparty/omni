import { createClerkClient } from '@clerk/backend'
import { requireClerkSecretKey } from './config'
import { clerkThrottle } from './throttle'

let cached: ReturnType<typeof createClerkClient> | undefined

// The dev Clerk instance. One per process: both arms of a comparison sign their
// users in through the same instance, only the gp-api they are provisioned
// through differs.
//
// Created on first use rather than at import, so importing this package never
// needs the secret. The e2e suite's own shim calls it at import, which is where
// its fail-fast has always lived; the judge resolves its config per run.
export const clerkClient = (): ReturnType<typeof createClerkClient> => {
  cached ??= createClerkClient({ secretKey: requireClerkSecretKey() })
  return cached
}

// Browser-minted Clerk session tokens expire after 60 seconds, so a token baked
// into a static Authorization header dies partway through any long flow. Mint
// the API token from a backend session instead, with a lifetime that outlasts
// the work.
const API_TOKEN_TTL_SECONDS = 60 * 60

export const mintApiToken = async (clerkUserId: string): Promise<string> => {
  const session = await clerkThrottle(() =>
    clerkClient().sessions.createSession({ userId: clerkUserId }),
  )
  const { jwt } = await clerkThrottle(() =>
    clerkClient().sessions.getToken(
      session.id,
      undefined,
      API_TOKEN_TTL_SECONDS,
    ),
  )
  return jwt
}

// A single-use Clerk sign-in token (the `__clerk_ticket`), the same call
// gp-api's magic link makes.
export const mintSignInTicket = async (
  clerkUserId: string,
  expiresInSeconds = 60 * 30,
): Promise<string> => {
  const signInToken = await clerkThrottle(() =>
    clerkClient().signInTokens.createSignInToken({
      userId: clerkUserId,
      expiresInSeconds,
    }),
  )
  if (!signInToken.token) {
    throw new Error('Clerk did not return a sign-in token')
  }
  return signInToken.token
}
