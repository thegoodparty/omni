import { generateKeyPairSync } from 'crypto'
import jwt from 'jsonwebtoken'
import { beforeEach, vi } from 'vitest'

const KID = 'test-vercel-oidc-key'
const MARKETING_PROJECT_ID = 'prj_xUbQGrErwISW8pqTZtKzk9wN5gFc'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
})
const jwksBody = JSON.stringify({
  keys: [
    {
      ...publicKey.export({ format: 'jwk' }),
      kid: KID,
      alg: 'RS256',
      use: 'sig',
    },
  ],
})
const realFetch = globalThis.fetch

// A gp-marketing production deployment's Vercel OIDC token, the token a
// service reader sends. gp-api accepts it only in a file that calls
// useTestVercelOidc().
export const signTestVercelOidcToken = (): string =>
  jwt.sign(
    {
      project: 'gp-marketing',
      project_id: MARKETING_PROJECT_ID,
      environment: 'production',
    },
    privateKey,
    {
      algorithm: 'RS256',
      keyid: KID,
      issuer: 'https://oidc.vercel.com/good-party',
      audience: 'https://vercel.com/good-party',
      subject: 'owner:good-party:project:gp-marketing:environment:production',
      expiresIn: '1h',
    },
  )

// Allowlists gp-marketing production and serves this file's key as the
// Vercel JWKS, so signTestVercelOidcToken() verifies for real.
export const useTestVercelOidc = (): void => {
  beforeEach(() => {
    vi.stubEnv(
      'VERCEL_OIDC_ALLOWED_PROJECTS',
      `${MARKETING_PROJECT_ID}:production`,
    )
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (!url.startsWith('https://oidc.vercel.com/')) {
        return realFetch(input, init)
      }
      return new Response(jwksBody, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
  })
}
