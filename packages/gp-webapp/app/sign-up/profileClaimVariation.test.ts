import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCookies, mockFetchV2, mockInitializeRemote, mockOverrides } =
  vi.hoisted(() => {
    const mockFetchV2 = vi.fn()
    return {
      mockCookies: vi.fn(),
      mockOverrides: vi.fn(),
      mockFetchV2,
      mockInitializeRemote: vi.fn(() => ({ fetchV2: mockFetchV2 })),
    }
  })

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: () => mockCookies(),
}))
vi.mock('@shared/experiments/flagOverrides', () => ({
  getFlagOverrides: () => mockOverrides(),
}))
vi.mock('@amplitude/experiment-node-server', () => ({
  Experiment: { initializeRemote: mockInitializeRemote },
}))

import {
  EVALUATION_TIMEOUT_MS,
  SIGNUP_PROFILE_CLAIM_FLAG_KEY,
  isProfileClaimVariationOn,
  parseSegmentAnonymousId,
} from './profileClaimVariation'

const ANON_ID = '3f1c2b9a-7d4e-4c1a-9b8e-2a6f5d0c1e7b'

const withCookie = (value: string | undefined) =>
  mockCookies.mockResolvedValue({
    get: (name: string) =>
      name === 'ajs_anonymous_id' && value !== undefined
        ? { name, value }
        : undefined,
  })

beforeEach(() => {
  vi.useRealTimers()
  vi.stubEnv('AMPLITUDE_EXPERIMENT_DEPLOYMENT_KEY', 'server-test-key')
  mockFetchV2.mockReset()
  mockOverrides.mockResolvedValue(null)
  withCookie(ANON_ID)
})

describe('parseSegmentAnonymousId', () => {
  it('reads the raw id the current Segment build writes', () => {
    expect(parseSegmentAnonymousId(ANON_ID)).toBe(ANON_ID)
  })

  it('reads the JSON-encoded id older analytics.js builds wrote', () => {
    expect(parseSegmentAnonymousId(`%22${ANON_ID}%22`)).toBe(ANON_ID)
    expect(parseSegmentAnonymousId(`"${ANON_ID}"`)).toBe(ANON_ID)
  })

  it('rejects a missing, empty, malformed or oversized value', () => {
    expect(parseSegmentAnonymousId(undefined)).toBeNull()
    expect(parseSegmentAnonymousId('')).toBeNull()
    expect(parseSegmentAnonymousId('%E0%A4%A')).toBeNull()
    expect(parseSegmentAnonymousId('not an id; drop table')).toBeNull()
    expect(parseSegmentAnonymousId('a'.repeat(129))).toBeNull()
  })
})

describe('isProfileClaimVariationOn', () => {
  it('is on when Amplitude returns on for the anonymous visitor', async () => {
    mockFetchV2.mockResolvedValue({
      [SIGNUP_PROFILE_CLAIM_FLAG_KEY]: { value: 'on' },
    })

    await expect(isProfileClaimVariationOn()).resolves.toBe(true)
    expect(mockFetchV2).toHaveBeenCalledWith(
      { device_id: ANON_ID },
      { flagKeys: [SIGNUP_PROFILE_CLAIM_FLAG_KEY] },
    )
  })

  it('evaluates with the server key, no retries and a short socket timeout', async () => {
    mockFetchV2.mockResolvedValue({})
    await isProfileClaimVariationOn()

    expect(mockInitializeRemote).toHaveBeenCalledWith('server-test-key', {
      fetchTimeoutMillis: EVALUATION_TIMEOUT_MS,
      fetchRetries: 0,
    })
  })

  it('is off when the flag is off or not assigned', async () => {
    mockFetchV2.mockResolvedValue({
      [SIGNUP_PROFILE_CLAIM_FLAG_KEY]: { value: 'off' },
    })
    await expect(isProfileClaimVariationOn()).resolves.toBe(false)

    mockFetchV2.mockResolvedValue({})
    await expect(isProfileClaimVariationOn()).resolves.toBe(false)
  })

  it('is off without calling Amplitude when the anonymous id is missing', async () => {
    withCookie(undefined)
    await expect(isProfileClaimVariationOn()).resolves.toBe(false)

    withCookie('not an id; drop table')
    await expect(isProfileClaimVariationOn()).resolves.toBe(false)

    expect(mockFetchV2).not.toHaveBeenCalled()
  })

  it('is off without calling Amplitude when the deployment key is unset', async () => {
    vi.stubEnv('AMPLITUDE_EXPERIMENT_DEPLOYMENT_KEY', '')
    await expect(isProfileClaimVariationOn()).resolves.toBe(false)
    expect(mockFetchV2).not.toHaveBeenCalled()
  })

  it('is off when Amplitude fails', async () => {
    mockFetchV2.mockRejectedValue(new Error('503 from Amplitude'))
    await expect(isProfileClaimVariationOn()).resolves.toBe(false)
  })

  it('honors the off-prod e2e override cookie without calling Amplitude', async () => {
    withCookie(undefined)
    mockOverrides.mockResolvedValue({
      [SIGNUP_PROFILE_CLAIM_FLAG_KEY]: { value: 'on' },
    })
    await expect(isProfileClaimVariationOn()).resolves.toBe(true)

    mockOverrides.mockResolvedValue({
      [SIGNUP_PROFILE_CLAIM_FLAG_KEY]: { value: 'off' },
    })
    await expect(isProfileClaimVariationOn()).resolves.toBe(false)

    expect(mockFetchV2).not.toHaveBeenCalled()
  })

  it('is off when Amplitude does not answer in time', async () => {
    vi.useFakeTimers()
    mockFetchV2.mockReturnValue(new Promise(vi.fn()))

    const result = isProfileClaimVariationOn()
    await vi.advanceTimersByTimeAsync(EVALUATION_TIMEOUT_MS)

    await expect(result).resolves.toBe(false)
  })
})
