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
import { PlacesService } from '@/electionDb/places/places.service'
import { useTestService } from '@/test-service'

const service = useTestService()

const ISSUER = 'https://token.actions.githubusercontent.com'
const KID = 'test-github-key'
const REPOSITORY = 'thegoodparty/gp-marketing'
const REPOSITORY_ID = '975716809'
const WORKFLOW = `${REPOSITORY}/.github/workflows/generate-people-sitemaps.yml`
const PROD_ALLOWLIST = `${WORKFLOW}@refs/heads/develop`
const DEV_ALLOWLIST = `${WORKFLOW}@*`
const SERVICE_READ_ROUTE = '/v1/public-person-profiles/published'

type SignOptions = {
  audience?: string
  repository?: string
  repositoryId?: string
  jobWorkflowRef?: string
  expiresAt?: number
  privateKey?: GenerateKeyPairResult['privateKey']
}

let githubKey: GenerateKeyPairResult
let otherKey: GenerateKeyPairResult
let jwksBody: string

const signGithubToken = async ({
  audience = 'gp-api',
  repository = REPOSITORY,
  repositoryId = REPOSITORY_ID,
  jobWorkflowRef = `${WORKFLOW}@refs/heads/develop`,
  expiresAt = Math.floor(Date.now() / 1000) + 300,
  privateKey = githubKey.privateKey,
}: SignOptions = {}): Promise<string> =>
  new SignJWT({
    repository,
    repository_id: repositoryId,
    repository_owner: 'thegoodparty',
    repository_owner_id: '45180019',
    workflow_ref: jobWorkflowRef,
    job_workflow_ref: jobWorkflowRef,
    ref: jobWorkflowRef.split('@')[1],
    event_name: 'schedule',
    run_id: '123456789',
  })
    .setProtectedHeader({ alg: 'RS256', kid: KID, typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setSubject(`repo:${repository}:ref:refs/heads/develop`)
    .setIssuedAt()
    .setNotBefore(Math.floor(Date.now() / 1000) - 60)
    .setExpirationTime(expiresAt)
    .sign(privateKey)

const signVercelToken = (): Promise<string> =>
  new SignJWT({
    project: 'gp-marketing',
    project_id: 'prj_xUbQGrErwISW8pqTZtKzk9wN5gFc',
    environment: 'production',
  })
    .setProtectedHeader({ alg: 'RS256', kid: KID, typ: 'JWT' })
    .setIssuer('https://oidc.vercel.com/good-party')
    .setAudience('https://vercel.com/good-party')
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
    .sign(githubKey.privateKey)

const realFetch = globalThis.fetch
let jwksReachable = true

const withBearer = (token: string) => ({
  headers: { Authorization: `Bearer ${token}` },
})

describe('GitHub Actions OIDC service readers', () => {
  beforeAll(async () => {
    githubKey = await generateKeyPair('RS256', { extractable: true })
    otherKey = await generateKeyPair('RS256', { extractable: true })
    const jwk = await exportJWK(githubKey.publicKey)
    jwksBody = JSON.stringify({
      keys: [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' }],
    })
  })

  beforeEach(() => {
    jwksReachable = true
    vi.stubEnv('GITHUB_OIDC_ALLOWED_WORKFLOWS', PROD_ALLOWLIST)
    vi.stubEnv(
      'VERCEL_OIDC_ALLOWED_PROJECTS',
      'prj_xUbQGrErwISW8pqTZtKzk9wN5gFc:production',
    )
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (
        !url.startsWith(`${ISSUER}/`) &&
        !url.startsWith('https://oidc.vercel.com/')
      ) {
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

  it('fails closed while the JWKS is unreachable, then recovers', async () => {
    const token = await signGithubToken()
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

  it('serves a service-read route to the allowlisted workflow and ref', async () => {
    const authProvider = service.app.get<AuthProvider>(AUTH_PROVIDER_TOKEN)

    const res = await service.client.get(
      SERVICE_READ_ROUTE,
      withBearer(await signGithubToken()),
    )

    expect(res.status).toBe(200)
    expect(authProvider.verifySessionToken).not.toHaveBeenCalled()
  })

  it('accepts any ref when the allowlist entry ends in @*', async () => {
    vi.stubEnv('GITHUB_OIDC_ALLOWED_WORKFLOWS', DEV_ALLOWLIST)

    const res = await service.client.get(
      SERVICE_READ_ROUTE,
      withBearer(
        await signGithubToken({
          jobWorkflowRef: `${WORKFLOW}@refs/heads/feature-branch`,
        }),
      ),
    )

    expect(res.status).toBe(200)
  })

  it('serves an election route behind the service-read concurrency cap', async () => {
    vi.spyOn(
      service.app.get(PlacesService),
      'getPlacesWithMostElections',
    ).mockResolvedValue([])

    const res = await service.client.get(
      '/v1/elections/places/most-elections',
      {
        params: { count: 5 },
        ...withBearer(await signGithubToken()),
      },
    )

    expect(res.status).toBe(200)
  })

  it.each<[string, SignOptions]>([
    ['the wrong audience', { audience: 'https://github.com/thegoodparty' }],
    [
      'another repository',
      {
        repository: 'thegoodparty/other-repo',
        jobWorkflowRef:
          'thegoodparty/other-repo/.github/workflows/generate-people-sitemaps.yml@refs/heads/develop',
      },
    ],
    [
      'another repository running the allowlisted workflow',
      { repository: 'someone-else/gp-marketing' },
    ],
    ['the wrong repository id', { repositoryId: '1' }],
    [
      'a workflow not on the allowlist',
      {
        jobWorkflowRef: `${REPOSITORY}/.github/workflows/deploy.yml@refs/heads/develop`,
      },
    ],
    [
      'an allowlisted workflow on another ref',
      { jobWorkflowRef: `${WORKFLOW}@refs/heads/feature-branch` },
    ],
    ['an expired token', { expiresAt: Math.floor(Date.now() / 1000) - 60 }],
  ])('403s %s', async (_label, options) => {
    const res = await service.client.get(
      SERVICE_READ_ROUTE,
      withBearer(await signGithubToken(options)),
    )

    expect(res.status).toBe(403)
  })

  it('403s a token signed by a key outside the JWKS', async () => {
    const res = await service.client.get(
      SERVICE_READ_ROUTE,
      withBearer(await signGithubToken({ privateKey: otherKey.privateKey })),
    )

    expect(res.status).toBe(403)
  })

  it('403s a valid token when the allowlist is empty', async () => {
    vi.stubEnv('GITHUB_OIDC_ALLOWED_WORKFLOWS', '')

    const res = await service.client.get(
      SERVICE_READ_ROUTE,
      withBearer(await signGithubToken()),
    )

    expect(res.status).toBe(403)
  })

  it('does not let a GitHub OIDC token through AdminOrM2MGuard', async () => {
    const res = await service.client.post(
      '/v1/person-profiles/removals',
      {
        personId: '33333333-3333-4333-8333-333333333333',
        appliedBy: 'privacy@goodparty.org',
      },
      withBearer(await signGithubToken()),
    )

    expect(res.status).toBe(401)
  })

  it('still serves a Vercel OIDC token', async () => {
    const res = await service.client.get(
      SERVICE_READ_ROUTE,
      withBearer(await signVercelToken()),
    )

    expect(res.status).toBe(200)
  })
})
