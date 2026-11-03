import {
  exportJWK,
  generateKeyPair,
  GenerateKeyPairResult,
  SignJWT,
} from 'jose'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'

const service = useTestService()

const ISSUER = 'https://abc123-def456.tokens.sts.global.api.aws'
const ROLE = 'arn:aws:iam::123456789012:role/delegate-swarm-host'
const KID = 'test-aws-key'

let keys: GenerateKeyPairResult
let jwksBody: string
const realFetch = globalThis.fetch

const signAwsToken = (): Promise<string> =>
  new SignJWT({})
    .setProtectedHeader({ alg: 'ES384', kid: KID, typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience('gp-api')
    .setSubject(ROLE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
    .sign(keys.privateKey)

describe('AWS OIDC hand-off agent token on the real app', () => {
  beforeAll(async () => {
    keys = await generateKeyPair('ES384', { extractable: true })
    jwksBody = JSON.stringify({
      keys: [{ ...(await exportJWK(keys.publicKey)), kid: KID, alg: 'ES384' }],
    })
  })

  beforeEach(() => {
    vi.stubEnv('AWS_OIDC_ISSUER', ISSUER)
    vi.stubEnv('AWS_OIDC_HANDOFF_AGENT_ROLES', ROLE)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (!url.startsWith(`${ISSUER}/`)) return realFetch(input, init)
      return new Response(jwksBody, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
  })

  it('is rejected by an AdminOrM2MGuard route', async () => {
    const res = await service.client.post(
      '/v1/person-profiles/removals',
      {
        personId: '33333333-3333-4333-8333-333333333333',
        appliedBy: 'privacy@goodparty.org',
      },
      { headers: { Authorization: `Bearer ${await signAwsToken()}` } },
    )

    expect(res.status).toBe(401)
  })

  it('is rejected by a service-read route and an ordinary authenticated route', async () => {
    const headers = { Authorization: `Bearer ${await signAwsToken()}` }

    const serviceRead = await service.client.get(
      '/v1/public-person-profiles/published',
      { headers },
    )
    const authed = await service.client.get('/v1/users/me', { headers })

    expect(serviceRead.status).toBe(401)
    expect(authed.status).toBe(401)
  })
})
