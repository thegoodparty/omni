import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFlagOn } from './FeatureFlagsProvider'
import { WIN_CRM_FLAG_KEY, useWinCrmFlag } from './winCrmFlag'

vi.mock('./FeatureFlagsProvider', () => ({
  useFlagOn: vi.fn(),
}))

const mockUseFlagOn = vi.mocked(useFlagOn)

describe('useWinCrmFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is disabled when the flag is off', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    const { result } = renderHook(() => useWinCrmFlag())

    expect(result.current).toEqual({ ready: true, enabled: false })
  })

  it('is enabled when the flag is on', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: true })

    const { result } = renderHook(() => useWinCrmFlag())

    expect(result.current).toEqual({ ready: true, enabled: true })
  })

  it('reads the win-crm key and tracks exposure by default', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    renderHook(() => useWinCrmFlag())

    expect(mockUseFlagOn).toHaveBeenCalledWith(WIN_CRM_FLAG_KEY, {
      trackExposure: true,
    })
  })

  it('forwards trackExposure=false so the read does not expose the user', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    renderHook(() => useWinCrmFlag(false))

    expect(mockUseFlagOn).toHaveBeenCalledWith(WIN_CRM_FLAG_KEY, {
      trackExposure: false,
    })
  })
})
