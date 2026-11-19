import {
  exportJWK,
  GenerateKeyPairResult,
  generateKeyPair,
  SignJWT,
} from 'jose'
import { PinoLogger } from 'nestjs-pino'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest'
import {
  AUTH_PROVIDER_TOKEN,
  AuthProvider,
} from '@/authentication/interfaces/auth-provider.interface'
import { useTestService } from '@/test-service'

const service = useTestService()

const TEAM_ISSUER = 'https://oidc.vercel.com/good-party'
const GLOBAL_ISSUER = 'https://oidc.vercel.com'
const AUDIENCE = 'https://vercel.com/good-party'
const KID = 'test-vercel-key'
const MARKETING_ID = 'prj_xUbQGrErwISW8pqTZtKzk9wN5gFc'
const ADMIN_ID = 'prj_ZT7POAebSPy3jFf2u0xKIUZTQpcT'
const SERVICE_READ_ROUTE = '/v1/public-person-profiles/published'

type SignOptions = {
  issuer?: string
  audience?: string
  projectId?: string
  project?: string
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
  project = 'gp-marketing',
  environment = 'production',
  expiresAt = Math.floor(Date.now() / 1000) + 3600,
  privateKey = vercelKey.privateKey,
}: SignOptions = {}): Promise<string> =>
  new SignJWT({
    owner: 'good-party',
    owner_id: 'team_e4HAh1NYJW4yYc38qx66yTtG',
    project,
    project_id: projectId,
    environment,
  })
    .setProtectedHeader({ alg: 'RS256', kid: KID, typ: 'JWT' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(
      `owner:good-party:project:${project}:environment:${environment}`,
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
  vi.stubEnv('VERCEL_OIDC_ADMIN_PROJECTS', `${ADMIN_ID}:production`)
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

describe('Vercel OIDC service readers', () => {
  it('serves a service-read route to an allowlisted project and environment', async () => {
    const authProvider = service.app.get<AuthProvider>(AUTH_PROVIDER_TOKEN)

    const res = await service.client.get(
      SERVICE_READ_ROUTE,
      withBearer(await signVercelToken()),
    )

    expect(res.status).toBe(200)
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

describe('Vercel OIDC admin callers', () => {
  const ADMIN_ROUTE = '/v1/admin/users/search'
  const M2M_ONLY_ROUTE = '/v1/admin/briefings'
  const OPERATOR = 'ops@goodparty.org'

  let info: MockInstance<PinoLogger['info']>
  let verifyM2MToken: MockInstance<AuthProvider['verifyM2MToken']>

  const signAdminToken = (options: SignOptions = {}) =>
    signVercelToken({
      projectId: ADMIN_ID,
      project: 'gp-admin-web',
      ...options,
    })

  beforeEach(() => {
    info = vi.spyOn(PinoLogger.prototype, 'info')
    verifyM2MToken = vi
      .spyOn(
        service.app.get<AuthProvider>(AUTH_PROVIDER_TOKEN),
        'verifyM2MToken',
      )
      .mockResolvedValue({ id: 'mt_test', subject: 'mch_gp_admin' })
  })

  // Restore only these spies: the harness installs its own mocks to
  // authenticate the test client, and a blanket restore logs it out.
  afterEach(() => {
    info.mockRestore()
    verifyM2MToken.mockRestore()
  })

  it('passes AdminOrM2MGuard and is audit-logged as the Vercel project', async () => {
    const res = await service.client.get(ADMIN_ROUTE, {
      params: { email: 'tests', actorEmail: OPERATOR },
      ...withBearer(await signAdminToken()),
    })

    expect(res.status).toBe(200)
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'Admin route accessed',
        authSource: 'm2m',
        machineId: 'vercel:gp-admin-web:production',
        suppliedActorEmail: OPERATOR,
        endpoint: expect.stringContaining(ADMIN_ROUTE),
      }),
    )
    expect(verifyM2MToken).not.toHaveBeenCalled()
  })

  it('passes an M2MOnly route', async () => {
    const res = await service.client.get(
      M2M_ONLY_ROUTE,
      withBearer(await signAdminToken()),
    )

    expect(res.status).toBe(200)
  })

  it('still serves a service-read route', async () => {
    const res = await service.client.get(
      SERVICE_READ_ROUTE,
      withBearer(await signAdminToken()),
    )

    expect(res.status).toBe(200)
  })

  it('grants admin when a project is on both lists', async () => {
    vi.stubEnv(
      'VERCEL_OIDC_ALLOWED_PROJECTS',
      `${MARKETING_ID}:production,${ADMIN_ID}:production`,
    )

    const res = await service.client.get(
      M2M_ONLY_ROUTE,
      withBearer(await signAdminToken()),
    )

    expect(res.status).toBe(200)
  })

  it('401s a reader-listed project on an M2MOnly route', async () => {
    const res = await service.client.get(
      M2M_ONLY_ROUTE,
      withBearer(await signVercelToken()),
    )

    expect(res.status).toBe(401)
  })

  it.each<[string, SignOptions]>([
    ['a preview deployment', { environment: 'preview' }],
    ['a development deployment', { environment: 'development' }],
    [
      'another project claiming the gp-admin name',
      { projectId: 'prj_someoneElse' },
    ],
    ['an expired token', { expiresAt: Math.floor(Date.now() / 1000) - 60 }],
    ['the wrong audience', { audience: 'https://vercel.com/other-team' }],
  ])('401s %s on an admin route', async (_label, options) => {
    const res = await service.client.get(ADMIN_ROUTE, {
      params: { email: 'tests' },
      ...withBearer(await signAdminToken(options)),
    })

    expect(res.status).toBe(401)
  })

  it('401s an admin token signed by a key outside the JWKS', async () => {
    const res = await service.client.get(
      M2M_ONLY_ROUTE,
      withBearer(await signAdminToken({ privateKey: otherKey.privateKey })),
    )

    expect(res.status).toBe(401)
  })

  it('401s the admin project when the admin list is empty', async () => {
    vi.stubEnv('VERCEL_OIDC_ADMIN_PROJECTS', '')

    const res = await service.client.get(
      M2M_ONLY_ROUTE,
      withBearer(await signAdminToken()),
    )

    expect(res.status).toBe(401)
  })

  it('still accepts a Clerk mt_ token on an admin route', async () => {
    const res = await service.client.get(M2M_ONLY_ROUTE, withBearer('mt_test'))

    expect(res.status).toBe(200)
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'Admin route accessed',
        authSource: 'm2m',
        machineId: 'mch_gp_admin',
      }),
    )
  })
})
