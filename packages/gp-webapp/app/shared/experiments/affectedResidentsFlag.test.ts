import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFlagOn } from './FeatureFlagsProvider'
import {
  AFFECTED_RESIDENTS_FLAG_KEY,
  useAffectedResidentsFlag,
} from './affectedResidentsFlag'

vi.mock('./FeatureFlagsProvider', () => ({
  useFlagOn: vi.fn(),
}))

const mockUseFlagOn = vi.mocked(useFlagOn)

describe('useAffectedResidentsFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is disabled when the flag is off', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false, failed: false })

    const { result } = renderHook(() => useAffectedResidentsFlag())

    expect(result.current).toEqual({ ready: true, enabled: false })
  })

  it('is enabled when the flag is on', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: true, failed: false })

    const { result } = renderHook(() => useAffectedResidentsFlag())

    expect(result.current).toEqual({ ready: true, enabled: true })
  })

  it('is not enabled while the flag is still loading', () => {
    mockUseFlagOn.mockReturnValue({ ready: false, on: false, failed: false })

    const { result } = renderHook(() => useAffectedResidentsFlag())

    expect(result.current).toEqual({ ready: false, enabled: false })
  })

  it('reads the serve-affected-residents key and tracks exposure by default', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false, failed: false })

    renderHook(() => useAffectedResidentsFlag())

    expect(mockUseFlagOn).toHaveBeenCalledWith(AFFECTED_RESIDENTS_FLAG_KEY, {
      trackExposure: true,
    })
  })

  it('forwards trackExposure=false so the entry card does not expose the user', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false, failed: false })

    renderHook(() => useAffectedResidentsFlag(false))

    expect(mockUseFlagOn).toHaveBeenCalledWith(AFFECTED_RESIDENTS_FLAG_KEY, {
      trackExposure: false,
    })
  })
})
