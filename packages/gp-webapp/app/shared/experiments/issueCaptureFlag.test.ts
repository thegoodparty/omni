import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFlagOn } from './FeatureFlagsProvider'
import { useIssueCaptureFlag } from './issueCaptureFlag'

vi.mock('./FeatureFlagsProvider', () => ({
  useFlagOn: vi.fn(),
}))

const mockUseFlagOn = vi.mocked(useFlagOn)

// Only the Win flag is on, so the answer says which flag was read.
const winOnly = (key: string) => ({
  ready: true,
  on: key === 'win-issue-capture',
})

describe('useIssueCaptureFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseFlagOn.mockImplementation(winOnly)
  })

  it('reads the Serve flag on Serve', () => {
    const { result } = renderHook(() => useIssueCaptureFlag(true))

    expect(result.current).toEqual({ ready: true, enabled: false })
  })

  it('reads the Win flag on Win', () => {
    const { result } = renderHook(() => useIssueCaptureFlag(false))

    expect(result.current).toEqual({ ready: true, enabled: true })
  })

  // Exposure is what an experiment counts. A Serve official reading the form
  // must not be counted as exposed to Win's rollout, or the other way round.
  it('exposes the user to their own product’s flag only', () => {
    renderHook(() => useIssueCaptureFlag(false))

    expect(mockUseFlagOn).toHaveBeenCalledWith('win-issue-capture', {
      trackExposure: true,
    })
    expect(mockUseFlagOn).toHaveBeenCalledWith('serve-issue-capture', {
      trackExposure: false,
    })
  })

  it('exposes nobody when the caller is not the treatment surface', () => {
    renderHook(() => useIssueCaptureFlag(true, false))

    expect(mockUseFlagOn).toHaveBeenCalledWith('serve-issue-capture', {
      trackExposure: false,
    })
    expect(mockUseFlagOn).toHaveBeenCalledWith('win-issue-capture', {
      trackExposure: false,
    })
  })
})
