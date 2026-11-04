import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GoodPartyClient } from './GoodPartyClient'

const { mockOfetch, mockGetVercelOidcToken } = vi.hoisted(() => ({
  mockOfetch: vi.fn(),
  mockGetVercelOidcToken: vi.fn(),
}))

vi.mock('ofetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ofetch')>()),
  ofetch: mockOfetch,
}))

vi.mock('@vercel/oidc', () => ({
  getVercelOidcToken: mockGetVercelOidcToken,
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
  })

  it('sends a freshly fetched Vercel OIDC token on every request', async () => {
    mockGetVercelOidcToken
      .mockResolvedValueOnce('oidc-token-at-create')
      .mockResolvedValueOnce('oidc-token-1')
      .mockResolvedValueOnce('oidc-token-2')

    const client = await GoodPartyClient.create({
      gpApiRootUrl: GP_API_ROOT_URL,
    })

    await client.users.get(1)
    await client.users.get(2)

    expect(sentAuthorizationHeaders()).toEqual([
      'Bearer oidc-token-1',
      'Bearer oidc-token-2',
    ])
    expect(mockGetVercelOidcToken).toHaveBeenCalledWith()
  })

  it('refuses to build a client when no Vercel OIDC token can be obtained', async () => {
    mockGetVercelOidcToken.mockRejectedValue(
      new Error("The 'x-vercel-oidc-token' header is missing from the request.")
    )

    const creation = GoodPartyClient.create({ gpApiRootUrl: GP_API_ROOT_URL })

    await expect(creation).rejects.toThrow('Vercel OIDC token unavailable')
    await expect(creation).rejects.toThrow('vercel env pull')
    expect(mockOfetch).not.toHaveBeenCalled()
  })
})
