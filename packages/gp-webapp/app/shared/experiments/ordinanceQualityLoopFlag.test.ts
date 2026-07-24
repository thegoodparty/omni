import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFlagOn } from './FeatureFlagsProvider'
import {
  ORDINANCE_QUALITY_LOOP_FLAG_KEY,
  useOrdinanceQualityLoopFlag,
} from './ordinanceQualityLoopFlag'

vi.mock('./FeatureFlagsProvider', () => ({
  useFlagOn: vi.fn(),
}))

const mockUseFlagOn = vi.mocked(useFlagOn)

describe('useOrdinanceQualityLoopFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is disabled when the flag is off', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    const { result } = renderHook(() => useOrdinanceQualityLoopFlag())

    expect(result.current).toEqual({ ready: true, enabled: false })
  })

  it('is enabled when the flag is on', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: true })

    const { result } = renderHook(() => useOrdinanceQualityLoopFlag())

    expect(result.current).toEqual({ ready: true, enabled: true })
  })

  it('reads the serve-ordinance-quality-loop key and tracks exposure by default', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    renderHook(() => useOrdinanceQualityLoopFlag())

    expect(mockUseFlagOn).toHaveBeenCalledWith(
      ORDINANCE_QUALITY_LOOP_FLAG_KEY,
      { trackExposure: true },
    )
    expect(ORDINANCE_QUALITY_LOOP_FLAG_KEY).toBe('serve-ordinance-quality-loop')
  })

  it('forwards trackExposure=false so the read does not expose the user', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    renderHook(() => useOrdinanceQualityLoopFlag(false))

    expect(mockUseFlagOn).toHaveBeenCalledWith(
      ORDINANCE_QUALITY_LOOP_FLAG_KEY,
      { trackExposure: false },
    )
  })
})
