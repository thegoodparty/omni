import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFlagOn } from './FeatureFlagsProvider'
import {
  WIN_ISSUE_CAPTURE_FLAG_KEY,
  useWinIssueCaptureFlag,
} from './winIssueCaptureFlag'

vi.mock('./FeatureFlagsProvider', () => ({
  useFlagOn: vi.fn(),
}))

const mockUseFlagOn = vi.mocked(useFlagOn)

describe('useWinIssueCaptureFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is enabled when the flag is on', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: true })

    const { result } = renderHook(() => useWinIssueCaptureFlag())

    expect(result.current).toEqual({ ready: true, enabled: true })
  })

  // The key has to match the one gp-api gates a Win org's capture routes on,
  // or the surface and the API roll out to different populations.
  it('reads the win-issue-capture key and tracks exposure by default', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    renderHook(() => useWinIssueCaptureFlag())

    expect(mockUseFlagOn).toHaveBeenCalledWith(WIN_ISSUE_CAPTURE_FLAG_KEY, {
      trackExposure: true,
    })
    expect(WIN_ISSUE_CAPTURE_FLAG_KEY).toBe('win-issue-capture')
  })

  it('forwards trackExposure=false so the read does not expose the user', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    renderHook(() => useWinIssueCaptureFlag(false))

    expect(mockUseFlagOn).toHaveBeenCalledWith(WIN_ISSUE_CAPTURE_FLAG_KEY, {
      trackExposure: false,
    })
  })
})
