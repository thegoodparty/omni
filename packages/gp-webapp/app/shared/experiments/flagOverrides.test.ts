import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockCookiesGet } = vi.hoisted(() => ({ mockCookiesGet: vi.fn() }))

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({ get: (name: string) => mockCookiesGet(name) }),
}))

import { getFlagOverrides, FLAG_OVERRIDE_COOKIE } from './flagOverrides'

const setCookie = (value?: string) =>
  mockCookiesGet.mockImplementation((name: string) =>
    name === FLAG_OVERRIDE_COOKIE && value ? { value } : undefined,
  )

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VERCEL_ENV', 'preview')
  setCookie(undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getFlagOverrides', () => {
  it('returns null when no override cookie is present', async () => {
    expect(await getFlagOverrides()).toBeNull()
  })

  it('returns the parsed variants on a non-prod env', async () => {
    setCookie(JSON.stringify({ 'campaign-story': { value: 'on' } }))

    expect(await getFlagOverrides()).toEqual({
      'campaign-story': { value: 'on' },
    })
  })

  it('is disabled on production even with the cookie set', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    setCookie(JSON.stringify({ 'campaign-story': { value: 'on' } }))

    expect(await getFlagOverrides()).toBeNull()
  })

  it('is honored on local dev (VERCEL_ENV unset)', async () => {
    vi.stubEnv('VERCEL_ENV', '')
    setCookie(JSON.stringify({ 'campaign-story': { value: 'on' } }))

    expect(await getFlagOverrides()).toEqual({
      'campaign-story': { value: 'on' },
    })
  })

  it('ignores a malformed (unparseable) cookie', async () => {
    setCookie('not json{')

    expect(await getFlagOverrides()).toBeNull()
  })

  it('ignores a cookie that parses but fails the variant schema', async () => {
    // Bare string instead of the { value } variant shape.
    setCookie(JSON.stringify({ 'campaign-story': 'on' }))

    expect(await getFlagOverrides()).toBeNull()
  })

  it('exposes the cookie name the e2e helper depends on', () => {
    // The e2e helper hardcodes this string (it can't import from app/); a rename
    // here must be mirrored there.
    expect(FLAG_OVERRIDE_COOKIE).toBe('e2e-flag-overrides')
  })
})
