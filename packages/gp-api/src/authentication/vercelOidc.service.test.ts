import {
  exportJWK,
  GenerateKeyPairResult,
  generateKeyPair,
  SignJWT,
} from 'jose'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AUTH_PROVIDER_TOKEN,
  AuthProvider,
} from '@/authentication/interfaces/auth-provider.interface'
import { signTestM2MJwt, useTestService } from '@/test-service'

const service = useTestService()

const TEAM_ISSUER = 'https://oidc.vercel.com/good-party'
const GLOBAL_ISSUER = 'https://oidc.vercel.com'
const AUDIENCE = 'https://vercel.com/good-party'
const KID = 'test-vercel-key'
const MARKETING_ID = 'prj_xUbQGrErwISW8pqTZtKzk9wN5gFc'
const SERVICE_READ_ROUTE = '/v1/public-person-profiles/published'

type SignOptions = {
  issuer?: string
  audience?: string
  projectId?: string
  environment?: string
  expiresAt?: number
  privateKey?: GenerateKeyPairResult['privateKey']
}

let vercelKey: GenerateKeyPairResult
let otherKey: GenerateKeyPairResult
let jwksBody: string

const signVercelToken = async ({
  issuer = TEAM_ISSUER,
  audience = AUDIENCE,
  projectId = MARKETING_ID,
  environment = 'production',
  expiresAt = Math.floor(Date.now() / 1000) + 3600,
  privateKey = vercelKey.privateKey,
}: SignOptions = {}): Promise<string> =>
  new SignJWT({
    owner: 'good-party',
    owner_id: 'team_e4HAh1NYJW4yYc38qx66yTtG',
    project: 'gp-marketing',
    project_id: projectId,
    environment,
  })
    .setProtectedHeader({ alg: 'RS256', kid: KID, typ: 'JWT' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(
      `owner:good-party:project:gp-marketing:environment:${environment}`,
    )
    .setIssuedAt()
    .setNotBefore(Math.floor(Date.now() / 1000) - 60)
    .setExpirationTime(expiresAt)
    .sign(privateKey)

const realFetch = globalThis.fetch
let jwksReachable = true

const withBearer = (token: string) => ({
  headers: { Authorization: `Bearer ${token}` },
})

describe('Vercel OIDC service readers', () => {
  beforeAll(async () => {
    vercelKey = await generateKeyPair('RS256', { extractable: true })
    otherKey = await generateKeyPair('RS256', { extractable: true })
    const jwk = await exportJWK(vercelKey.publicKey)
    jwksBody = JSON.stringify({
      keys: [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' }],
    })
  })

  beforeEach(() => {
    jwksReachable = true
    vi.stubEnv(
      'VERCEL_OIDC_ALLOWED_PROJECTS',
      `${MARKETING_ID}:production, prj_candidateSites:production`,
    )
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (!url.startsWith('https://oidc.vercel.com/')) {
        return realFetch(input, init)
      }
      if (!jwksReachable) {
        throw new TypeError('fetch failed')
      }
      return new Response(jwksBody, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
  })

  it('serves a service-read route to an allowlisted project and environment', async () => {
    const authProvider = service.app.get<AuthProvider>(AUTH_PROVIDER_TOKEN)

    const res = await service.client.get(
      SERVICE_READ_ROUTE,
      withBearer(await signVercelToken()),
    )

    expect(res.status).toBe(200)
    expect(authProvider.verifyM2MJwt).not.toHaveBeenCalled()
    expect(authProvider.verifySessionToken).not.toHaveBeenCalled()
  })

  it('fails closed while the global JWKS is unreachable, then recovers', async () => {
    const token = await signVercelToken({ issuer: GLOBAL_ISSUER })
    jwksReachable = false

    const unreachable = await service.client.get(
      SERVICE_READ_ROUTE,
      withBearer(token),
    )

    expect(unreachable.status).toBe(403)

    jwksReachable = true
    const recovered = await service.client.get(
      SERVICE_READ_ROUTE,
      withBearer(token),
    )

    expect(recovered.status).toBe(200)
  })

  it.each<[string, SignOptions]>([
    ['a project not on the allowlist', { projectId: 'prj_someoneElse' }],
    [
      'an allowlisted project in another environment',
      { environment: 'preview' },
    ],
    ['an expired token', { expiresAt: Math.floor(Date.now() / 1000) - 60 }],
    ['the wrong audience', { audience: 'https://vercel.com/other-team' }],
    ['another team issuer', { issuer: 'https://oidc.vercel.com/other-team' }],
  ])('403s %s', async (_label, options) => {
    const res = await service.client.get(
      SERVICE_READ_ROUTE,
      withBearer(await signVercelToken(options)),
    )

    expect(res.status).toBe(403)
  })

  it('403s a token signed by a key outside the JWKS', async () => {
    const res = await service.client.get(
      SERVICE_READ_ROUTE,
      withBearer(await signVercelToken({ privateKey: otherKey.privateKey })),
    )

    expect(res.status).toBe(403)
  })

  it('403s a valid token when the allowlist is empty', async () => {
    vi.stubEnv('VERCEL_OIDC_ALLOWED_PROJECTS', '')

    const res = await service.client.get(
      SERVICE_READ_ROUTE,
      withBearer(await signVercelToken()),
    )

    expect(res.status).toBe(403)
  })

  it('still serves a Clerk JWT-format M2M token', async () => {
    const res = await service.client.get(
      SERVICE_READ_ROUTE,
      withBearer(signTestM2MJwt()),
    )

    expect(res.status).toBe(200)
  })

  it('does not let a Vercel OIDC token through AdminOrM2MGuard', async () => {
    const res = await service.client.post(
      '/v1/person-profiles/removals',
      {
        personId: '33333333-3333-4333-8333-333333333333',
        appliedBy: 'privacy@goodparty.org',
      },
      withBearer(await signVercelToken()),
    )

    expect(res.status).toBe(401)
  })

  it('does not let a Vercel OIDC token onto a plain authenticated route', async () => {
    const res = await service.client.get(
      '/v1/person-profiles/mine',
      withBearer(await signVercelToken()),
    )

    expect(res.status).toBe(401)
  })
})
