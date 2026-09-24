import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFlagOn } from './FeatureFlagsProvider'
import {
  OUTREACH_PRO_GATING_V2_FLAG_KEY,
  useOutreachProGatingV2Flag,
} from './outreachProGatingV2Flag'

vi.mock('./FeatureFlagsProvider', () => ({ useFlagOn: vi.fn() }))
const mockUseFlagOn = vi.mocked(useFlagOn)

describe('useOutreachProGatingV2Flag', () => {
  it('reads the outreach-pro-gating-v2 key and reports enabled when on', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: true, failed: false })
    const { result } = renderHook(() => useOutreachProGatingV2Flag())
    expect(mockUseFlagOn).toHaveBeenCalledWith(
      OUTREACH_PRO_GATING_V2_FLAG_KEY,
      {
        trackExposure: true,
      },
    )
    expect(result.current).toEqual({ ready: true, enabled: true })
  })

  it('passes trackExposure=false through for non-treatment reads', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false, failed: false })
    const { result } = renderHook(() => useOutreachProGatingV2Flag(false))
    expect(mockUseFlagOn).toHaveBeenCalledWith(
      OUTREACH_PRO_GATING_V2_FLAG_KEY,
      {
        trackExposure: false,
      },
    )
    expect(result.current.enabled).toBe(false)
  })
})
