import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFlagOn } from './FeatureFlagsProvider'
import { SERVE_CRM_FLAG_KEY, useServeCrmFlag } from './serveCrmFlag'

vi.mock('./FeatureFlagsProvider', () => ({
  useFlagOn: vi.fn(),
}))

const mockUseFlagOn = vi.mocked(useFlagOn)

describe('useServeCrmFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is disabled when the flag is off', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    const { result } = renderHook(() => useServeCrmFlag())

    expect(result.current).toEqual({ ready: true, enabled: false })
  })

  it('is enabled when the flag is on', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: true })

    const { result } = renderHook(() => useServeCrmFlag())

    expect(result.current).toEqual({ ready: true, enabled: true })
  })

  it('reads the serve-crm key and tracks exposure by default', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    renderHook(() => useServeCrmFlag())

    expect(mockUseFlagOn).toHaveBeenCalledWith(SERVE_CRM_FLAG_KEY, {
      trackExposure: true,
    })
  })

  it('forwards trackExposure=false so the read does not expose the user', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    renderHook(() => useServeCrmFlag(false))

    expect(mockUseFlagOn).toHaveBeenCalledWith(SERVE_CRM_FLAG_KEY, {
      trackExposure: false,
    })
  })
})
