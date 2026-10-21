import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFlagOn } from './FeatureFlagsProvider'
import { ISSUE_CAPTURE_FLAG_KEY, useIssueCaptureFlag } from './issueCaptureFlag'

vi.mock('./FeatureFlagsProvider', () => ({
  useFlagOn: vi.fn(),
}))

const mockUseFlagOn = vi.mocked(useFlagOn)

describe('useIssueCaptureFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is enabled when the flag is on', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: true })

    const { result } = renderHook(() => useIssueCaptureFlag())

    expect(result.current).toEqual({ ready: true, enabled: true })
  })

  it('is not enabled until the flag is ready', () => {
    mockUseFlagOn.mockReturnValue({ ready: false, on: false })

    const { result } = renderHook(() => useIssueCaptureFlag())

    expect(result.current).toEqual({ ready: false, enabled: false })
  })

  it('reads the one issue-capture key and tracks exposure by default', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    renderHook(() => useIssueCaptureFlag())

    expect(ISSUE_CAPTURE_FLAG_KEY).toBe('issue-capture')
    expect(mockUseFlagOn).toHaveBeenCalledTimes(1)
    expect(mockUseFlagOn).toHaveBeenCalledWith('issue-capture', {
      trackExposure: true,
    })
  })

  it('exposes nobody when the caller is not the treatment surface', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: true })

    renderHook(() => useIssueCaptureFlag(false))

    expect(mockUseFlagOn).toHaveBeenCalledWith('issue-capture', {
      trackExposure: false,
    })
  })
})
