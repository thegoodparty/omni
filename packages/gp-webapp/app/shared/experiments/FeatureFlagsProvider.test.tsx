import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { User, UserRole } from 'helpers/types'

vi.mock('@shared/sentry', () => ({ reportErrorToSentry: vi.fn() }))

const mockTrack = vi.fn()
vi.mock('@shared/utils/analytics', () => ({
  getReadyAnalytics: vi.fn(async () => ({ track: mockTrack })),
}))

let mockUser: User | null = null
let mockIsUserLoading = false
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [mockUser, vi.fn(), mockIsUserLoading],
}))

import React from 'react'
import { reportErrorToSentry } from '@shared/sentry'
import {
  FeatureFlagsProvider,
  useFeatureFlags,
  useFlagOn,
} from './FeatureFlagsProvider'

const VARIANTS_ROUTE = '/api/feature-flags'

const fullUser: User = {
  id: 42,
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  phone: '555-1234',
  zip: '90210',
  roles: [UserRole.candidate],
  hasPassword: true,
}

// gp-api-resolved variants the /api/feature-flags route returns, controllable
// per test. The mock throws on any non-/api/feature-flags URL, so a stray
// Amplitude call would fail the test — resolution must stay same-origin.
// (A global fetch stub, not api.mock/MSW, because /api/feature-flags is a Next
// route handler, not an APIEndpoints entry MSW could key off.)
let serverVariants: Record<string, { value?: string }> = {}
let fetchShouldReject = false
let fetchOk = true
const fetchMock = vi.fn(async (url: string) => {
  if (url !== VARIANTS_ROUTE) throw new Error(`unexpected fetch: ${url}`)
  if (fetchShouldReject) throw new Error('network error')
  return {
    ok: fetchOk,
    json: async () => ({ variants: serverVariants }),
  } as unknown as Response
})

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <FeatureFlagsProvider>{children}</FeatureFlagsProvider>
)

const seededWrapper = ({ children }: { children: React.ReactNode }) => (
  <FeatureFlagsProvider initialVariants={{ 'campaign-story': { value: 'on' } }}>
    {children}
  </FeatureFlagsProvider>
)

beforeEach(() => {
  mockUser = null
  mockIsUserLoading = false
  serverVariants = {}
  fetchShouldReject = false
  fetchOk = true
  fetchMock.mockClear()
  mockTrack.mockClear()
  vi.mocked(reportErrorToSentry).mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('server-seeded initialVariants', () => {
  it('is ready immediately and never fetches when seeded for an authed user', async () => {
    mockUser = fullUser

    const { result } = renderHook(() => useFlagOn('campaign-story'), {
      wrapper: seededWrapper,
    })

    expect(result.current.ready).toBe(true)
    expect(result.current.on).toBe(true)
    // Give the gated effect a chance to (wrongly) fetch; it must not.
    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('re-resolves instead of trusting a stale seed when the session is gone at hydration', async () => {
    // The seed was rendered for an authed user server-side, but the client
    // hydrates with no user (session expired between SSR and hydration). The
    // provider must NOT keep serving the authed seed — it re-resolves through
    // gp-api, which returns empty for an anonymous request. (The effect only
    // runs after isUserLoading is false, so a null user here is definitively
    // gone, not transitionally missing.)
    mockUser = null
    mockIsUserLoading = false
    serverVariants = {}

    const { result } = renderHook(() => useFlagOn('campaign-story'), {
      wrapper: seededWrapper,
    })

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(VARIANTS_ROUTE, {
        credentials: 'include',
      }),
    )
    await waitFor(() => expect(result.current.on).toBe(false))
  })

  it('re-resolves through gp-api when the identity changes after seeding', async () => {
    mockUser = fullUser
    serverVariants = { 'campaign-story': { value: 'off' } }

    const { result, rerender } = renderHook(() => useFlagOn('campaign-story'), {
      wrapper: seededWrapper,
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(fetchMock).not.toHaveBeenCalled()

    mockUser = { ...fullUser, id: 99 }
    rerender()

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(VARIANTS_ROUTE, {
        credentials: 'include',
      }),
    )
    await waitFor(() => expect(result.current.on).toBe(false))
  })
})

describe('client resolution (no seed)', () => {
  it('resolves an authed user through gp-api, never Amplitude', async () => {
    mockUser = fullUser
    serverVariants = { 'my-feature': { value: 'on' } }

    const { result } = renderHook(() => useFlagOn('my-feature'), { wrapper })

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(fetchMock).toHaveBeenCalledWith(VARIANTS_ROUTE, {
      credentials: 'include',
    })
    expect(result.current.on).toBe(true)
    // The whole point: resolution is same-origin only, exactly once — never
    // a second/Amplitude call. (The mock throws on any other URL.)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls.every(([url]) => url === VARIANTS_ROUTE)).toBe(
      true,
    )
  })

  it('stays empty for an anonymous visitor and never fetches', async () => {
    mockUser = null

    const { result } = renderHook(() => useFlagOn('my-feature'), { wrapper })

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.on).toBe(false)
  })

  it('re-resolves on login (anonymous -> authed)', async () => {
    mockUser = null
    serverVariants = { 'my-feature': { value: 'on' } }

    const { result, rerender } = renderHook(() => useFlagOn('my-feature'), {
      wrapper,
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(fetchMock).not.toHaveBeenCalled()

    mockUser = fullUser
    rerender()

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(VARIANTS_ROUTE, {
        credentials: 'include',
      }),
    )
    await waitFor(() => expect(result.current.on).toBe(true))
  })

  it('clears to empty on logout (authed -> anonymous)', async () => {
    mockUser = fullUser
    serverVariants = { 'my-feature': { value: 'on' } }

    const { result, rerender } = renderHook(() => useFlagOn('my-feature'), {
      wrapper,
    })
    await waitFor(() => expect(result.current.on).toBe(true))

    mockUser = null
    rerender()

    await waitFor(() => expect(result.current.on).toBe(false))
  })
})

describe('user-loading gate', () => {
  it('does not fetch or become ready while the user is still loading', async () => {
    mockIsUserLoading = true

    const { result } = renderHook(() => useFeatureFlags(), { wrapper })

    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.ready).toBe(false)
  })
})

describe('refresh error handling', () => {
  it('becomes ready and reports to Sentry when the refresh fetch fails', async () => {
    mockUser = fullUser
    fetchShouldReject = true

    const { result } = renderHook(() => useFeatureFlags(), { wrapper })

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(reportErrorToSentry).toHaveBeenCalledWith(expect.any(Error), {
      context: 'FeatureFlagsProvider.refresh',
    })
  })
})

describe('exposure tracking', () => {
  it('fires $exposure once per flag key via variant() (deduped)', async () => {
    mockUser = fullUser

    const { result } = renderHook(() => useFeatureFlags(), {
      wrapper: seededWrapper,
    })
    await waitFor(() => expect(result.current.ready).toBe(true))

    act(() => {
      result.current.variant('campaign-story')
      result.current.variant('campaign-story')
      result.current.variant('campaign-story')
    })

    await waitFor(() =>
      expect(mockTrack).toHaveBeenCalledWith('$exposure', {
        flag_key: 'campaign-story',
        variant: 'on',
      }),
    )
    expect(mockTrack).toHaveBeenCalledTimes(1)
  })

  it('does not fire $exposure for all()', async () => {
    mockUser = fullUser

    const { result } = renderHook(() => useFeatureFlags(), {
      wrapper: seededWrapper,
    })
    await waitFor(() => expect(result.current.ready).toBe(true))

    act(() => {
      result.current.all()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockTrack).not.toHaveBeenCalled()
  })
})

describe('context value', () => {
  it('clear() empties the variant set', async () => {
    mockUser = fullUser

    const { result } = renderHook(() => useFeatureFlags(), {
      wrapper: seededWrapper,
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.all()).toEqual({ 'campaign-story': { value: 'on' } })

    act(() => {
      result.current.clear()
    })
    expect(result.current.all()).toEqual({})
  })

  it('variant() falls back to the provided fallback for an unknown key', async () => {
    mockUser = fullUser

    const { result } = renderHook(() => useFeatureFlags(), {
      wrapper: seededWrapper,
    })
    await waitFor(() => expect(result.current.ready).toBe(true))

    expect(result.current.variant('unknown', { value: 'off' })).toEqual({
      value: 'off',
    })
  })
})

describe('useFlagOn', () => {
  it('uses variant() (the exposing path) by default', async () => {
    mockUser = fullUser

    const { result } = renderHook(() => useFlagOn('campaign-story'), {
      wrapper: seededWrapper,
    })
    await waitFor(() => expect(result.current.ready).toBe(true))

    expect(result.current.on).toBe(true)
    await waitFor(() =>
      expect(mockTrack).toHaveBeenCalledWith('$exposure', {
        flag_key: 'campaign-story',
        variant: 'on',
      }),
    )
  })

  it('uses all() and fires no exposure when trackExposure is false', async () => {
    mockUser = fullUser

    const { result } = renderHook(
      () => useFlagOn('campaign-story', { trackExposure: false }),
      { wrapper: seededWrapper },
    )
    await waitFor(() => expect(result.current.ready).toBe(true))

    expect(result.current.on).toBe(true)
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockTrack).not.toHaveBeenCalled()
  })

  it('returns on=false while the provider is not ready', () => {
    mockIsUserLoading = true

    const { result } = renderHook(() => useFlagOn('campaign-story'), {
      wrapper,
    })

    expect(result.current.ready).toBe(false)
    expect(result.current.on).toBe(false)
  })
})

describe('regression coverage', () => {
  it('re-resolves on a same-id trait change (segment input edit)', async () => {
    // gp-api/Amplitude segment on traits (e.g. zip), so a same-session trait
    // edit must re-resolve even though the user id is unchanged.
    mockUser = fullUser
    serverVariants = { 'my-feature': { value: 'off' } }

    const { result, rerender } = renderHook(() => useFlagOn('my-feature'), {
      wrapper,
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    serverVariants = { 'my-feature': { value: 'on' } }
    mockUser = { ...fullUser, zip: '10001' }
    rerender()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.on).toBe(true))
  })

  it('fails safe to empty (does not serve the prior identity) when a refresh 4xx/5xxs', async () => {
    // An HTTP error (res.ok === false) is not a thrown network error, so it
    // must NOT noise up Sentry — but the variants from the previous identity
    // must not linger either. refresh() runs on the identity change without
    // pre-clearing, so the provider has to clear to empty: an unresolvable flag
    // reads off, never stale.
    mockUser = fullUser
    serverVariants = { 'campaign-story': { value: 'on' } }

    const { result, rerender } = renderHook(() => useFlagOn('campaign-story'), {
      wrapper: seededWrapper,
    })
    await waitFor(() => expect(result.current.on).toBe(true))
    expect(fetchMock).not.toHaveBeenCalled()

    fetchOk = false
    mockUser = { ...fullUser, id: 99 }
    rerender()

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await waitFor(() => expect(result.current.on).toBe(false))
    expect(reportErrorToSentry).not.toHaveBeenCalled()
  })

  it('clears a seeded variant set on real logout', async () => {
    mockUser = fullUser

    const { result, rerender } = renderHook(() => useFlagOn('campaign-story'), {
      wrapper: seededWrapper,
    })
    await waitFor(() => expect(result.current.on).toBe(true))

    mockUser = null
    rerender()

    await waitFor(() => expect(result.current.on).toBe(false))
  })

  it('re-fires $exposure after a refresh replaces the variant set', async () => {
    mockUser = fullUser
    serverVariants = { 'campaign-story': { value: 'on' } }

    const { result, rerender } = renderHook(() => useFeatureFlags(), {
      wrapper: seededWrapper,
    })
    await waitFor(() => expect(result.current.ready).toBe(true))

    act(() => {
      result.current.variant('campaign-story')
    })
    await waitFor(() => expect(mockTrack).toHaveBeenCalledTimes(1))

    // An identity change refreshes and resets the exposure dedup set.
    mockUser = { ...fullUser, id: 99 }
    rerender()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    act(() => {
      result.current.variant('campaign-story')
    })
    await waitFor(() => expect(mockTrack).toHaveBeenCalledTimes(2))
  })
})
