import { vi, describe, it, expect, beforeEach } from 'vitest'
import cookie from 'js-cookie'

vi.mock('./segmentHelper', () => ({
  segmentTrackEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('app/shared/utils/analytics', () => ({
  getReadyAnalytics: vi.fn(),
}))

vi.mock('js-cookie', () => ({
  default: {
    get: vi.fn(),
    set: vi.fn(),
  },
}))

import {
  trackEvent,
  setImpersonating,
  setUserEmail,
  getMetaClickIds,
  trackRegistrationCompleted,
  EVENTS,
} from './analyticsHelper'
import { segmentTrackEvent } from './segmentHelper'

describe('trackEvent', () => {
  beforeEach(() => {
    setImpersonating(false)
    setUserEmail(undefined)
    vi.clearAllMocks()
    sessionStorage.clear()
  })

  it('includes impersonation: false when not impersonating', () => {
    trackEvent('Test Event', { foo: 'bar' })

    expect(segmentTrackEvent).toHaveBeenCalledWith(
      'Test Event',
      expect.objectContaining({
        foo: 'bar',
        impersonation: false,
      }),
    )
  })

  it('includes impersonation: true when impersonating', () => {
    setImpersonating(true)

    trackEvent('Test Event', { foo: 'bar' })

    expect(segmentTrackEvent).toHaveBeenCalledWith(
      'Test Event',
      expect.objectContaining({
        foo: 'bar',
        impersonation: true,
      }),
    )
  })

  it('impersonation cannot be overridden by caller properties', () => {
    setImpersonating(true)

    trackEvent('Test Event', { impersonation: false })

    expect(segmentTrackEvent).toHaveBeenCalledWith(
      'Test Event',
      expect.objectContaining({
        impersonation: true,
      }),
    )
  })

  it('does not include email when no user email is set', () => {
    trackEvent('Test Event', { foo: 'bar' })

    expect(segmentTrackEvent).toHaveBeenCalledWith(
      'Test Event',
      expect.not.objectContaining({ email: expect.anything() }),
    )
  })

  it('includes email on every event once the user email is set', () => {
    setUserEmail('jane@example.com')

    trackEvent('Test Event', { foo: 'bar' })

    expect(segmentTrackEvent).toHaveBeenCalledWith(
      'Test Event',
      expect.objectContaining({
        foo: 'bar',
        email: 'jane@example.com',
      }),
    )
  })

  it('caller-provided email overrides the persisted user email', () => {
    setUserEmail('jane@example.com')

    trackEvent('Test Event', { email: 'override@example.com' })

    expect(segmentTrackEvent).toHaveBeenCalledWith(
      'Test Event',
      expect.objectContaining({
        email: 'override@example.com',
      }),
    )
  })
})

describe('getMetaClickIds', () => {
  beforeEach(() => {
    vi.mocked(cookie.get).mockReset()
  })

  it('returns fbc and fbp from cookies when present', () => {
    vi.mocked(cookie.get).mockImplementation((name: string) => {
      if (name === '_fbc') return 'fb.1.1234567890.test-fbclid'
      if (name === '_fbp') return 'fb.1.1234567890.987654321'
      return undefined
    })

    expect(getMetaClickIds()).toEqual({
      fbc: 'fb.1.1234567890.test-fbclid',
      fbp: 'fb.1.1234567890.987654321',
    })
  })

  it('omits missing Meta cookies', () => {
    vi.mocked(cookie.get).mockReturnValue(undefined)

    expect(getMetaClickIds()).toEqual({})
  })
})

describe('trackRegistrationCompleted', () => {
  beforeEach(() => {
    setImpersonating(false)
    setUserEmail(undefined)
    vi.clearAllMocks()
    sessionStorage.clear()
    vi.mocked(cookie.get).mockReset()
  })

  it('attaches fbc, fbp, and persisted fbclid to identify and track', async () => {
    sessionStorage.setItem('fbclid_first', 'test-fbclid')
    sessionStorage.setItem('fbclid_last', 'test-fbclid')
    vi.mocked(cookie.get).mockImplementation((name: string) => {
      if (name === '_fbc') return 'fb.1.1234567890.test-fbclid'
      if (name === '_fbp') return 'fb.1.1234567890.987654321'
      if (name === 'hubspotutk') return 'hutk-value'
      return undefined
    })

    const identify = vi.fn()
    const ready = vi.fn().mockResolvedValue(undefined)
    const analytics = Promise.resolve({ identify, ready } as any)

    await trackRegistrationCompleted({
      analytics,
      userId: '42',
      email: 'new-user@example.com',
    })

    expect(identify).toHaveBeenCalledWith(
      '42',
      expect.objectContaining({
        email: 'new-user@example.com',
        hutk: 'hutk-value',
        signUpMethod: 'email',
        fbc: 'fb.1.1234567890.test-fbclid',
        fbp: 'fb.1.1234567890.987654321',
        fbclid: 'test-fbclid',
      }),
    )
    expect(segmentTrackEvent).toHaveBeenCalledWith(
      EVENTS.Onboarding.RegistrationCompleted,
      expect.objectContaining({
        signUpMethod: 'email',
        fbc: 'fb.1.1234567890.test-fbclid',
        fbp: 'fb.1.1234567890.987654321',
        fbclid: 'test-fbclid',
      }),
    )
  })

  it('prefers fbclid_last over fbclid_first', async () => {
    sessionStorage.setItem('fbclid_first', 'first-click')
    sessionStorage.setItem('fbclid_last', 'last-click')
    vi.mocked(cookie.get).mockReturnValue(undefined)

    const identify = vi.fn()
    const analytics = Promise.resolve({ identify } as any)

    await trackRegistrationCompleted({
      analytics,
      userId: '7',
    })

    expect(identify).toHaveBeenCalledWith(
      '7',
      expect.objectContaining({ fbclid: 'last-click' }),
    )
    expect(segmentTrackEvent).toHaveBeenCalledWith(
      EVENTS.Onboarding.RegistrationCompleted,
      expect.objectContaining({ fbclid: 'last-click' }),
    )
  })

  it('awaits the track event before resolving', async () => {
    let trackResolved = false
    vi.mocked(segmentTrackEvent).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            trackResolved = true
            resolve(undefined)
          }, 10)
        }),
    )
    vi.mocked(cookie.get).mockReturnValue(undefined)

    const analytics = Promise.resolve(null)

    await trackRegistrationCompleted({
      analytics,
      userId: '1',
    })

    expect(trackResolved).toBe(true)
  })
})
