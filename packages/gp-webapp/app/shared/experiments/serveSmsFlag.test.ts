import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFlagOn } from './FeatureFlagsProvider'
import { SERVE_SMS_FLAG_KEY, useServeSmsFlag } from './serveSmsFlag'

vi.mock('./FeatureFlagsProvider', () => ({
  useFlagOn: vi.fn(),
}))

const mockUseFlagOn = vi.mocked(useFlagOn)

describe('useServeSmsFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is disabled when the flag is off', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    const { result } = renderHook(() => useServeSmsFlag())

    expect(result.current).toEqual({ ready: true, enabled: false })
  })

  it('is enabled when the flag is on', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: true })

    const { result } = renderHook(() => useServeSmsFlag())

    expect(result.current).toEqual({ ready: true, enabled: true })
  })

  // The key has to match the one gp-api gates the two Serve SMS routes on,
  // or the surface and the API roll out to different populations.
  it('reads the serve-sms-outreach key and tracks exposure by default', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    renderHook(() => useServeSmsFlag())

    expect(mockUseFlagOn).toHaveBeenCalledWith(SERVE_SMS_FLAG_KEY, {
      trackExposure: true,
    })
    expect(SERVE_SMS_FLAG_KEY).toBe('serve-sms-outreach')
  })

  it('forwards trackExposure=false so the read does not expose the user', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    renderHook(() => useServeSmsFlag(false))

    expect(mockUseFlagOn).toHaveBeenCalledWith(SERVE_SMS_FLAG_KEY, {
      trackExposure: false,
    })
  })
})
