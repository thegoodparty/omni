import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockServerRequest,
  mockGetServerToken,
  mockIsTokenExpired,
  mockGetFlagOverrides,
} = vi.hoisted(() => ({
  mockServerRequest: vi.fn(),
  mockGetServerToken: vi.fn(),
  mockIsTokenExpired: vi.fn(),
  mockGetFlagOverrides: vi.fn(),
}))

vi.mock('gpApi/server-request', () => ({
  serverRequest: (...args: unknown[]) => mockServerRequest(...args),
}))

vi.mock('helpers/tokenHelper', () => ({
  getServerToken: () => mockGetServerToken(),
  isTokenExpired: (token: string) => mockIsTokenExpired(token),
}))

vi.mock('./flagOverrides', () => ({
  getFlagOverrides: () => mockGetFlagOverrides(),
}))

import { getFlagVariants } from './getFlagVariants'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetServerToken.mockResolvedValue('token')
  mockIsTokenExpired.mockReturnValue(false)
  mockGetFlagOverrides.mockResolvedValue(null)
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

  it('returns null (does not throw) on a network-level error', async () => {
    // ofetch throws on DNS/timeout/connection errors; an uncaught throw here
    // would 500 every authed SSR render via PageWrapper's Promise.all.
    mockServerRequest.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(getFlagVariants()).resolves.toBeNull()
  })
})

describe('getFlagVariants with an e2e override', () => {
  it('honors the override without a server token (preview test user)', async () => {
    // Preview e2e users authenticate via a cookie the Clerk server session can't
    // read, so getServerToken returns nothing — the override must still apply.
    mockGetServerToken.mockResolvedValue(undefined)
    mockGetFlagOverrides.mockResolvedValue({
      'campaign-story': { value: 'on' },
    })

    expect(await getFlagVariants()).toEqual({
      'campaign-story': { value: 'on' },
    })
    expect(mockServerRequest).not.toHaveBeenCalled()
  })

  it('merges the override over gp-api variants (override wins)', async () => {
    mockServerRequest.mockResolvedValue({
      ok: true,
      data: {
        variants: {
          'campaign-story': { value: 'off' },
          'other-flag': { value: 'on' },
        },
      },
    })
    mockGetFlagOverrides.mockResolvedValue({
      'campaign-story': { value: 'on' },
    })

    expect(await getFlagVariants()).toEqual({
      'campaign-story': { value: 'on' },
      'other-flag': { value: 'on' },
    })
  })

  it('applies the override when gp-api resolution fails', async () => {
    mockServerRequest.mockResolvedValue({ ok: false, data: null })
    mockGetFlagOverrides.mockResolvedValue({
      'campaign-story': { value: 'on' },
    })

    expect(await getFlagVariants()).toEqual({
      'campaign-story': { value: 'on' },
    })
  })

  it('applies the override when gp-api throws', async () => {
    mockServerRequest.mockRejectedValue(new Error('ECONNREFUSED'))
    mockGetFlagOverrides.mockResolvedValue({
      'campaign-story': { value: 'on' },
    })

    expect(await getFlagVariants()).toEqual({
      'campaign-story': { value: 'on' },
    })
  })
})
