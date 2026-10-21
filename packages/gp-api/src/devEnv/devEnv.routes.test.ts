import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'
import { HeadObjectCommand, NotFound, S3Client } from '@aws-sdk/client-s3'
import { HttpStatus } from '@nestjs/common'
import { mockClient } from 'aws-sdk-client-mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'

// The unit tests cover each layer's logic. This one exists for the wiring the
// decorators carry — @PublicAccess() letting a caller with no gp-api session
// through the global SessionGuard, @UseGuards(GithubOrgMemberGuard) actually
// being applied, and the response surviving ZodResponseInterceptor — none of
// which a directly-constructed controller exercises.
const { envNonProd } = vi.hoisted(() => ({ envNonProd: { value: true } }))
vi.mock('@/shared/util/appEnvironment.util', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/shared/util/appEnvironment.util')>()
  return {
    ...actual,
    get IS_NON_PROD_DEPLOY() {
      return envNonProd.value
    },
  }
})

const secretsMock = mockClient(SecretsManagerClient)
const s3Mock = mockClient(S3Client)
const service = useTestService()

const BEARER = { 'X-GitHub-Token': 'gho_a_github_user_token' }
const CLERK_DEV_VALUE = 'sk_test_devenvroutestest'

const activeMembership = () =>
  new Response(
    JSON.stringify({ state: 'active', user: { login: 'octocat' } }),
    { status: HttpStatus.OK, headers: { 'Content-Type': 'application/json' } },
  )

describe('POST /v1/dev-env/bundle', () => {
  beforeEach(() => {
    envNonProd.value = true
    process.env.LOCAL_DEV_ENV_SECRET_ID = 'LOCAL_DEV_ENV'
    secretsMock.reset()
    secretsMock.on(GetSecretValueCommand).resolves({
      SecretString: JSON.stringify({
        'gp-api': { CLERK_SECRET_KEY: CLERK_DEV_VALUE },
      }),
    })
  })

  afterEach(() => {
    delete process.env.LOCAL_DEV_ENV_SECRET_ID
    vi.unstubAllGlobals()
  })

  it('vends to an active org member holding no gp-api session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(activeMembership()))

    const res = await service.client.post(
      '/v1/dev-env/bundle',
      { packages: ['gp-api'] },
      { headers: BEARER },
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({
      bundles: [
        { package: 'gp-api', variables: { CLERK_SECRET_KEY: CLERK_DEV_VALUE } },
      ],
    })
  })

  it('401s a caller with no bearer token', async () => {
    const res = await service.client.post('/v1/dev-env/bundle', {})

    expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
  })

  it('403s a GitHub user who is not an active member', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 404 })),
    )

    const res = await service.client.post(
      '/v1/dev-env/bundle',
      {},
      { headers: BEARER },
    )

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('404s outside a non-prod deploy without calling GitHub', async () => {
    envNonProd.value = false
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await service.client.post(
      '/v1/dev-env/bundle',
      {},
      { headers: BEARER },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('503s when the vending secret is not configured', async () => {
    delete process.env.LOCAL_DEV_ENV_SECRET_ID
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(activeMembership()))

    const res = await service.client.post(
      '/v1/dev-env/bundle',
      {},
      { headers: BEARER },
    )

    expect(res.status).toBe(HttpStatus.SERVICE_UNAVAILABLE)
  })
})

describe('POST /v1/dev-env/election-seed', () => {
  const BUCKET = 'gp-local-election-seed-dev'

  beforeEach(() => {
    envNonProd.value = true
    process.env.LOCAL_ELECTION_SEED_BUCKET = BUCKET
    // The presigner signs with whatever credentials the client resolves. A
    // set AWS_PROFILE makes the SDK skip env credentials entirely, so clear it
    // and supply a fixed pair: the test then never reaches a real profile.
    vi.stubEnv('AWS_PROFILE', '')
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'AKIAEXAMPLE')
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'example-secret')
    s3Mock.reset()
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 1 })
  })

  afterEach(() => {
    delete process.env.LOCAL_ELECTION_SEED_BUCKET
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('hands an active org member a presigned URL for the seed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(activeMembership()))

    const res = await service.client.post(
      '/v1/dev-env/election-seed',
      {},
      { headers: BEARER },
    )

    expect(res.status).toBe(HttpStatus.OK)
    const url = new URL(res.data.url)
    expect(url.hostname).toContain(BUCKET)
    expect(url.pathname).toBe('/election-seed.sql.gz')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
    expect(new Date(res.data.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })

  it('401s a caller with no GitHub token', async () => {
    const res = await service.client.post('/v1/dev-env/election-seed', {})

    expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
  })

  it('404s outside a non-prod deploy without calling GitHub', async () => {
    envNonProd.value = false
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await service.client.post(
      '/v1/dev-env/election-seed',
      {},
      { headers: BEARER },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('503s when no seed bucket is configured', async () => {
    delete process.env.LOCAL_ELECTION_SEED_BUCKET
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(activeMembership()))

    const res = await service.client.post(
      '/v1/dev-env/election-seed',
      {},
      { headers: BEARER },
    )

    expect(res.status).toBe(HttpStatus.SERVICE_UNAVAILABLE)
  })

  it('503s when the seed has not been uploaded yet', async () => {
    s3Mock
      .on(HeadObjectCommand)
      .rejects(new NotFound({ message: 'Not Found', $metadata: {} }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(activeMembership()))

    const res = await service.client.post(
      '/v1/dev-env/election-seed',
      {},
      { headers: BEARER },
    )

    expect(res.status).toBe(HttpStatus.SERVICE_UNAVAILABLE)
  })
})
