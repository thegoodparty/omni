import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFlagOn } from './FeatureFlagsProvider'
import { TEAM_ACCOUNTS_FLAG_KEY, useTeamAccountsFlag } from './teamAccountsFlag'

vi.mock('./FeatureFlagsProvider', () => ({
  useFlagOn: vi.fn(),
}))

const mockUseFlagOn = vi.mocked(useFlagOn)

describe('useTeamAccountsFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is disabled when the flag is off', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    const { result } = renderHook(() => useTeamAccountsFlag())

    expect(result.current).toEqual({ ready: true, enabled: false })
  })

  it('is enabled when the flag is on', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: true })

    const { result } = renderHook(() => useTeamAccountsFlag())

    expect(result.current).toEqual({ ready: true, enabled: true })
  })

  it('reads the win-team-accounts key and tracks exposure by default', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    renderHook(() => useTeamAccountsFlag())

    expect(mockUseFlagOn).toHaveBeenCalledWith(TEAM_ACCOUNTS_FLAG_KEY, {
      trackExposure: true,
    })
  })

  it('forwards trackExposure=false so the read does not expose the user', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    renderHook(() => useTeamAccountsFlag(false))

    expect(mockUseFlagOn).toHaveBeenCalledWith(TEAM_ACCOUNTS_FLAG_KEY, {
      trackExposure: false,
    })
  })
})
