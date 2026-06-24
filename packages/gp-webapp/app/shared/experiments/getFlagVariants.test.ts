import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockServerRequest,
  mockGetServerToken,
  mockIsTokenExpired,
  mockCookiesGet,
  envFlags,
} = vi.hoisted(() => ({
  mockServerRequest: vi.fn(),
  mockGetServerToken: vi.fn(),
  mockIsTokenExpired: vi.fn(),
  mockCookiesGet: vi.fn(),
  // Mutable so each test can place the resolver on a preview / non-preview env.
  envFlags: { IS_PREVIEW: true, IS_LOCAL: false },
}))

vi.mock('gpApi/server-request', () => ({
  serverRequest: (...args: unknown[]) => mockServerRequest(...args),
}))

vi.mock('helpers/tokenHelper', () => ({
  getServerToken: () => mockGetServerToken(),
  isTokenExpired: (token: string) => mockIsTokenExpired(token),
}))

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({ get: (name: string) => mockCookiesGet(name) }),
}))

vi.mock('appEnv', () => ({
  get IS_PREVIEW() {
    return envFlags.IS_PREVIEW
  },
  get IS_LOCAL() {
    return envFlags.IS_LOCAL
  },
}))

import { getFlagVariants } from './getFlagVariants'
import { FLAG_OVERRIDE_COOKIE } from './flagOverrides'

const setOverrideCookie = (value?: string) =>
  mockCookiesGet.mockImplementation((name: string) =>
    name === FLAG_OVERRIDE_COOKIE && value ? { value } : undefined,
  )

beforeEach(() => {
  vi.clearAllMocks()
  envFlags.IS_PREVIEW = true
  envFlags.IS_LOCAL = false
  mockGetServerToken.mockResolvedValue('token')
  mockIsTokenExpired.mockReturnValue(false)
  setOverrideCookie(undefined)
})

describe('getFlagVariants', () => {
  it('returns null for an anonymous request (no token)', async () => {
    mockGetServerToken.mockResolvedValue(undefined)

    expect(await getFlagVariants()).toBeNull()
    expect(mockServerRequest).not.toHaveBeenCalled()
  })

  it('returns null when the token is expired', async () => {
    mockIsTokenExpired.mockReturnValue(true)

    expect(await getFlagVariants()).toBeNull()
    expect(mockServerRequest).not.toHaveBeenCalled()
  })

  it('returns gp-api variants when resolution succeeds', async () => {
    mockServerRequest.mockResolvedValue({
      ok: true,
      data: { variants: { 'serve-access': { value: 'off' } } },
    })

    expect(await getFlagVariants()).toEqual({
      'serve-access': { value: 'off' },
    })
  })

  it('returns null when gp-api resolution fails and there is no override', async () => {
    mockServerRequest.mockResolvedValue({ ok: false, data: null })

    expect(await getFlagVariants()).toBeNull()
  })

  it('merges the override cookie over gp-api variants on a preview', async () => {
    mockServerRequest.mockResolvedValue({
      ok: true,
      data: {
        variants: {
          'serve-access': { value: 'off' },
          'other-flag': { value: 'on' },
        },
      },
    })
    setOverrideCookie(JSON.stringify({ 'serve-access': { value: 'on' } }))

    expect(await getFlagVariants()).toEqual({
      'serve-access': { value: 'on' },
      'other-flag': { value: 'on' },
    })
  })

  it('applies the override even when gp-api resolution fails', async () => {
    mockServerRequest.mockResolvedValue({ ok: false, data: null })
    setOverrideCookie(JSON.stringify({ 'serve-access': { value: 'on' } }))

    expect(await getFlagVariants()).toEqual({
      'serve-access': { value: 'on' },
    })
  })

  it('ignores the override cookie outside preview / local (dev / qa / prod)', async () => {
    envFlags.IS_PREVIEW = false
    envFlags.IS_LOCAL = false
    mockServerRequest.mockResolvedValue({
      ok: true,
      data: { variants: { 'serve-access': { value: 'off' } } },
    })
    setOverrideCookie(JSON.stringify({ 'serve-access': { value: 'on' } }))

    expect(await getFlagVariants()).toEqual({
      'serve-access': { value: 'off' },
    })
  })

  it('honors the override cookie on local dev', async () => {
    envFlags.IS_PREVIEW = false
    envFlags.IS_LOCAL = true
    mockServerRequest.mockResolvedValue({ ok: true, data: { variants: {} } })
    setOverrideCookie(JSON.stringify({ 'serve-access': { value: 'on' } }))

    expect(await getFlagVariants()).toEqual({
      'serve-access': { value: 'on' },
    })
  })

  it('ignores a malformed override cookie', async () => {
    mockServerRequest.mockResolvedValue({
      ok: true,
      data: { variants: { 'serve-access': { value: 'off' } } },
    })
    setOverrideCookie('not json{')

    expect(await getFlagVariants()).toEqual({
      'serve-access': { value: 'off' },
    })
  })
})
