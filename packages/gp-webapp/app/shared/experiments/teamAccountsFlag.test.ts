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
    mockUseFlagOn.mockReturnValue({ ready: true, on: false, failed: false })

    const { result } = renderHook(() => useTeamAccountsFlag())

    expect(result.current).toEqual({
      ready: true,
      enabled: false,
      failed: false,
    })
  })

  it('is enabled when the flag is on', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: true, failed: false })

    const { result } = renderHook(() => useTeamAccountsFlag())

    expect(result.current).toEqual({
      ready: true,
      enabled: true,
      failed: false,
    })
  })

  it('passes through a genuine fetch failure', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false, failed: true })

    const { result } = renderHook(() => useTeamAccountsFlag())

    expect(result.current).toEqual({
      ready: true,
      enabled: false,
      failed: true,
    })
  })

  it('reads the win-team-accounts key and tracks exposure by default', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false, failed: false })

    renderHook(() => useTeamAccountsFlag())

    expect(mockUseFlagOn).toHaveBeenCalledWith(TEAM_ACCOUNTS_FLAG_KEY, {
      trackExposure: true,
    })
  })

  it('forwards trackExposure=false so the read does not expose the user', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false, failed: false })

    renderHook(() => useTeamAccountsFlag(false))

    expect(mockUseFlagOn).toHaveBeenCalledWith(TEAM_ACCOUNTS_FLAG_KEY, {
      trackExposure: false,
    })
  })
})
