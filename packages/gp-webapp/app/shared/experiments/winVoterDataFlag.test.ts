import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFlagOn } from './FeatureFlagsProvider'
import {
  WIN_VOTER_DATA_FLAG_KEY,
  useWinVoterDataFlag,
} from './winVoterDataFlag'

vi.mock('./FeatureFlagsProvider', () => ({
  useFlagOn: vi.fn(),
}))

const mockUseFlagOn = vi.mocked(useFlagOn)

describe('useWinVoterDataFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is disabled when the flag is off', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    const { result } = renderHook(() => useWinVoterDataFlag())

    expect(result.current).toEqual({ ready: true, enabled: false })
  })

  it('is enabled when the flag is on', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: true })

    const { result } = renderHook(() => useWinVoterDataFlag())

    expect(result.current).toEqual({ ready: true, enabled: true })
  })

  it('reads the win-voter-data key and tracks exposure by default', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    renderHook(() => useWinVoterDataFlag())

    expect(mockUseFlagOn).toHaveBeenCalledWith(WIN_VOTER_DATA_FLAG_KEY, {
      trackExposure: true,
    })
  })

  it('forwards trackExposure=false so the read does not expose the user', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    renderHook(() => useWinVoterDataFlag(false))

    expect(mockUseFlagOn).toHaveBeenCalledWith(WIN_VOTER_DATA_FLAG_KEY, {
      trackExposure: false,
    })
  })
})
