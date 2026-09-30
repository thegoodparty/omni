import { ExecutionContext } from '@nestjs/common'
import {
  BadGatewayException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DevEnvRequest } from '../devEnv.types'
import { GithubOrgMemberGuard } from './GithubOrgMember.guard'

// IS_NON_PROD_DEPLOY is a module-level constant; the unit-test env has no
// OTEL_SERVICE_ENVIRONMENT so the real value is false. Toggle it per-test.
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

// Real-shaped GET /user/memberships/orgs/{org} payload.
const membershipBody = (state: string) => ({
  url: 'https://api.github.com/orgs/thegoodparty/memberships/octocat',
  state,
  role: 'member',
  organization: { login: 'thegoodparty' },
  user: { login: 'octocat', id: 1 },
})

const jsonResponse = (status: number, body: object) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('GithubOrgMemberGuard', () => {
  let guard: GithubOrgMemberGuard
  let req: DevEnvRequest
  let fetchMock: ReturnType<typeof vi.fn>

  const contextFor = (request: DevEnvRequest) =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext

  beforeEach(() => {
    envNonProd.value = true
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const logger = {
      setContext: vi.fn(),
      error: vi.fn(),
    } as unknown as PinoLogger
    guard = new GithubOrgMemberGuard(logger)
    req = {
      headers: { authorization: 'Bearer gho_a_github_user_token' },
    } as unknown as DevEnvRequest
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('admits an active org member and records only their login', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, membershipBody('active')))

    await expect(guard.canActivate(contextFor(req))).resolves.toBe(true)
    expect(req.githubLogin).toBe('octocat')
  })

  it('sends the token to the membership endpoint and nowhere else', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, membershipBody('active')))

    await guard.canActivate(contextFor(req))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://api.github.com/user/memberships/orgs/thegoodparty',
    )
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer gho_a_github_user_token',
    })
  })

  it('rejects an invitation that has not been accepted', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, membershipBody('pending')))

    await expect(guard.canActivate(contextFor(req))).rejects.toThrow(
      ForbiddenException,
    )
  })

  it('rejects a revoked or expired token as 401', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { message: 'Bad credentials' }),
    )

    await expect(guard.canActivate(contextFor(req))).rejects.toThrow(
      UnauthorizedException,
    )
  })

  it('rejects a non-member as 403', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { message: 'Not Found' }))

    await expect(guard.canActivate(contextFor(req))).rejects.toThrow(
      ForbiddenException,
    )
  })

  it('rejects a token without read:org as 403', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { message: 'Forbidden' }))

    await expect(guard.canActivate(contextFor(req))).rejects.toThrow(
      ForbiddenException,
    )
  })

  it('502s when the GitHub request cannot be made', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    await expect(guard.canActivate(contextFor(req))).rejects.toThrow(
      BadGatewayException,
    )
  })

  it('502s when GitHub itself is failing', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { message: 'unavailable' }))

    await expect(guard.canActivate(contextFor(req))).rejects.toThrow(
      BadGatewayException,
    )
  })

  it('502s when GitHub answers 200 with a body it cannot parse', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>proxy error</html>', { status: 200 }),
    )

    await expect(guard.canActivate(contextFor(req))).rejects.toThrow(
      BadGatewayException,
    )
  })

  it.each([
    ['no header', undefined],
    ['a non-bearer scheme', 'token gho_x'],
  ])('rejects %s without calling GitHub', async (_label, authorization) => {
    req = { headers: { authorization } } as unknown as DevEnvRequest

    await expect(guard.canActivate(contextFor(req))).rejects.toThrow(
      UnauthorizedException,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('404s outside a non-prod deploy before touching GitHub', async () => {
    envNonProd.value = false

    await expect(guard.canActivate(contextFor(req))).rejects.toThrow(
      NotFoundException,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never logs the bearer token', async () => {
    const logged: unknown[] = []
    const logger = {
      setContext: vi.fn(),
      error: vi.fn((...args: unknown[]) => logged.push(...args)),
    } as unknown as PinoLogger
    guard = new GithubOrgMemberGuard(logger)
    fetchMock.mockResolvedValue(jsonResponse(503, { message: 'unavailable' }))

    await expect(guard.canActivate(contextFor(req))).rejects.toThrow(
      BadGatewayException,
    )
    expect(JSON.stringify(logged)).not.toContain('gho_a_github_user_token')
  })
})
