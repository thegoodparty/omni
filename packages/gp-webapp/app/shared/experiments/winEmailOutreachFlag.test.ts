import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFlagOn } from './FeatureFlagsProvider'
import {
  WIN_EMAIL_OUTREACH_FLAG_KEY,
  useWinEmailOutreachFlag,
} from './winEmailOutreachFlag'

vi.mock('./FeatureFlagsProvider', () => ({
  useFlagOn: vi.fn(),
}))

const mockUseFlagOn = vi.mocked(useFlagOn)

describe('useWinEmailOutreachFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads the win-email-outreach key and tracks exposure by default', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: true })

    const { result } = renderHook(() => useWinEmailOutreachFlag())

    expect(result.current).toEqual({ ready: true, enabled: true })
    expect(mockUseFlagOn).toHaveBeenCalledWith(WIN_EMAIL_OUTREACH_FLAG_KEY, {
      trackExposure: true,
    })
    expect(WIN_EMAIL_OUTREACH_FLAG_KEY).toBe('win-email-outreach')
  })

  it('is disabled when the flag is off', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    const { result } = renderHook(() => useWinEmailOutreachFlag(false))

    expect(result.current.enabled).toBe(false)
    expect(mockUseFlagOn).toHaveBeenCalledWith(WIN_EMAIL_OUTREACH_FLAG_KEY, {
      trackExposure: false,
    })
  })
})
