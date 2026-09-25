import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFlagOn } from './FeatureFlagsProvider'
import {
  SERVE_ISSUE_CAPTURE_FLAG_KEY,
  useServeIssueCaptureFlag,
} from './serveIssueCaptureFlag'

vi.mock('./FeatureFlagsProvider', () => ({
  useFlagOn: vi.fn(),
}))

const mockUseFlagOn = vi.mocked(useFlagOn)

describe('useServeIssueCaptureFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is disabled when the flag is off', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    const { result } = renderHook(() => useServeIssueCaptureFlag())

    expect(result.current).toEqual({ ready: true, enabled: false })
  })

  it('is enabled when the flag is on', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: true })

    const { result } = renderHook(() => useServeIssueCaptureFlag())

    expect(result.current).toEqual({ ready: true, enabled: true })
  })

  // The key has to match the one gp-api gates the capture write route on, or
  // the surface and the API roll out to different populations.
  it('reads the serve-issue-capture key and tracks exposure by default', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    renderHook(() => useServeIssueCaptureFlag())

    expect(mockUseFlagOn).toHaveBeenCalledWith(SERVE_ISSUE_CAPTURE_FLAG_KEY, {
      trackExposure: true,
    })
    expect(SERVE_ISSUE_CAPTURE_FLAG_KEY).toBe('serve-issue-capture')
  })

  it('forwards trackExposure=false so the read does not expose the user', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    renderHook(() => useServeIssueCaptureFlag(false))

    expect(mockUseFlagOn).toHaveBeenCalledWith(SERVE_ISSUE_CAPTURE_FLAG_KEY, {
      trackExposure: false,
    })
  })
})
