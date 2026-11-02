import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GoodPartyClient, GP_API_AUTH_MODE } from './GoodPartyClient'

const { mockOfetch, mockGetVercelOidcToken, mockClerkGetToken } = vi.hoisted(
  () => ({
    mockOfetch: vi.fn(),
    mockGetVercelOidcToken: vi.fn(),
    mockClerkGetToken: vi.fn(),
  })
)

vi.mock('ofetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ofetch')>()),
  ofetch: mockOfetch,
}))

vi.mock('@vercel/oidc', () => ({
  getVercelOidcToken: mockGetVercelOidcToken,
}))

vi.mock('./vendor/clerk/clerk.service', () => ({
  ClerkService: class {
    getToken = mockClerkGetToken
    destroy = vi.fn()
  },
}))

const GP_API_ROOT_URL = 'http://gp-api.test/v1'

const sentAuthorizationHeaders = (): string[] =>
  mockOfetch.mock.calls.map(
    (call) =>
      (call[1] as { headers: Record<string, string> }).headers.Authorization
  )

describe('GoodPartyClient auth header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOfetch.mockResolvedValue({})
    mockClerkGetToken.mockResolvedValue('clerk-m2m-token')
  })

  it('sends the Clerk M2M token in clerk mode', async () => {
    const client = await GoodPartyClient.create({
      authMode: GP_API_AUTH_MODE.CLERK,
      m2mSecret: 'ak_test',
      gpApiRootUrl: GP_API_ROOT_URL,
    })

    await client.users.get(1)

    expect(sentAuthorizationHeaders()).toEqual(['Bearer clerk-m2m-token'])
    expect(mockGetVercelOidcToken).not.toHaveBeenCalled()
  })

  it('refuses to build a clerk-mode client without a machine secret', async () => {
    await expect(
      GoodPartyClient.create({
        authMode: GP_API_AUTH_MODE.CLERK,
        gpApiRootUrl: GP_API_ROOT_URL,
      })
    ).rejects.toThrow('No machine secret is set')
  })

  it('sends a freshly fetched Vercel OIDC token on every request in oidc mode', async () => {
    mockGetVercelOidcToken
      .mockResolvedValueOnce('oidc-token-at-create')
      .mockResolvedValueOnce('oidc-token-1')
      .mockResolvedValueOnce('oidc-token-2')

    const client = await GoodPartyClient.create({
      authMode: GP_API_AUTH_MODE.OIDC,
      m2mSecret: 'ak_test',
      gpApiRootUrl: GP_API_ROOT_URL,
    })

    await client.users.get(1)
    await client.users.get(2)

    expect(sentAuthorizationHeaders()).toEqual([
      'Bearer oidc-token-1',
      'Bearer oidc-token-2',
    ])
    expect(mockGetVercelOidcToken).toHaveBeenCalledWith()
    expect(mockClerkGetToken).not.toHaveBeenCalled()
  })

  it('builds an oidc-mode client without a machine secret when the token is available', async () => {
    mockGetVercelOidcToken.mockResolvedValue('oidc-token')

    const client = await GoodPartyClient.create({
      authMode: GP_API_AUTH_MODE.OIDC,
      gpApiRootUrl: GP_API_ROOT_URL,
    })

    await client.users.get(1)

    expect(sentAuthorizationHeaders()).toEqual(['Bearer oidc-token'])
  })

  it('falls back to the Clerk M2M token when the Vercel OIDC token is unavailable', async () => {
    mockGetVercelOidcToken.mockRejectedValue(
      new Error("The 'x-vercel-oidc-token' header is missing from the request.")
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const client = await GoodPartyClient.create({
      authMode: GP_API_AUTH_MODE.OIDC,
      m2mSecret: 'ak_test',
      gpApiRootUrl: GP_API_ROOT_URL,
    })

    await client.users.get(1)

    expect(sentAuthorizationHeaders()).toEqual(['Bearer clerk-m2m-token'])
    warn.mockRestore()
  })

  it('refuses to build an oidc-mode client with no token and no machine secret', async () => {
    mockGetVercelOidcToken.mockRejectedValue(
      new Error("The 'x-vercel-oidc-token' header is missing from the request.")
    )

    await expect(
      GoodPartyClient.create({
        authMode: GP_API_AUTH_MODE.OIDC,
        gpApiRootUrl: GP_API_ROOT_URL,
      })
    ).rejects.toThrow(
      'Vercel OIDC token unavailable and no machine secret is set'
    )
  })
})
