import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockServerRequest, mockGetServerToken, mockIsTokenExpired } =
  vi.hoisted(() => ({
    mockServerRequest: vi.fn(),
    mockGetServerToken: vi.fn(),
    mockIsTokenExpired: vi.fn(),
  }))

vi.mock('gpApi/server-request', () => ({
  serverRequest: (...args: unknown[]) => mockServerRequest(...args),
}))

vi.mock('helpers/tokenHelper', () => ({
  getServerToken: () => mockGetServerToken(),
  isTokenExpired: (token: string) => mockIsTokenExpired(token),
}))

import { getFlagVariants } from './getFlagVariants'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetServerToken.mockResolvedValue('token')
  mockIsTokenExpired.mockReturnValue(false)
})

describe('getFlagVariants', () => {
  it('returns null for an anonymous request (no token) without calling gp-api', async () => {
    mockGetServerToken.mockResolvedValue(undefined)

    expect(await getFlagVariants()).toBeNull()
    expect(mockServerRequest).not.toHaveBeenCalled()
  })

  it('returns null when the token is expired without calling gp-api', async () => {
    mockIsTokenExpired.mockReturnValue(true)

    expect(await getFlagVariants()).toBeNull()
    expect(mockServerRequest).not.toHaveBeenCalled()
  })

  it('returns the gp-api variants when resolution succeeds', async () => {
    mockServerRequest.mockResolvedValue({
      ok: true,
      data: { variants: { 'serve-access': { value: 'on' } } },
    })

    expect(await getFlagVariants()).toEqual({
      'serve-access': { value: 'on' },
    })
  })

  it('returns null when gp-api resolution fails', async () => {
    mockServerRequest.mockResolvedValue({ ok: false, data: null })

    expect(await getFlagVariants()).toBeNull()
  })
})
