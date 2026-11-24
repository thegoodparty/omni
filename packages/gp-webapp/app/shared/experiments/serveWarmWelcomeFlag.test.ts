import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFlagOn } from './FeatureFlagsProvider'
import {
  SERVE_WARM_WELCOME_FLAG_KEY,
  useServeWarmWelcomeFlag,
} from './serveWarmWelcomeFlag'

vi.mock('./FeatureFlagsProvider', () => ({
  useFlagOn: vi.fn(),
}))

const mockUseFlagOn = vi.mocked(useFlagOn)

describe('useServeWarmWelcomeFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is disabled when the flag is off', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    const { result } = renderHook(() => useServeWarmWelcomeFlag())

    expect(result.current).toEqual({ ready: true, enabled: false })
  })

  it('is enabled when the flag is on', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: true })

    const { result } = renderHook(() => useServeWarmWelcomeFlag())

    expect(result.current).toEqual({ ready: true, enabled: true })
  })

  it('reads the serve-warm-welcome key and tracks exposure by default', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    renderHook(() => useServeWarmWelcomeFlag())

    expect(mockUseFlagOn).toHaveBeenCalledWith(SERVE_WARM_WELCOME_FLAG_KEY, {
      trackExposure: true,
    })
    expect(SERVE_WARM_WELCOME_FLAG_KEY).toBe('serve-warm-welcome')
  })

  it('forwards trackExposure=false so the read does not expose the user', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    renderHook(() => useServeWarmWelcomeFlag(false))

    expect(mockUseFlagOn).toHaveBeenCalledWith(SERVE_WARM_WELCOME_FLAG_KEY, {
      trackExposure: false,
    })
  })
})
