import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFlagOn } from './FeatureFlagsProvider'
import {
  SERVE_SELF_SERVE_POLLS_FLAG_KEY,
  useServeSelfServePollsFlag,
} from './serveSelfServePollsFlag'

vi.mock('./FeatureFlagsProvider', () => ({
  useFlagOn: vi.fn(),
}))

const mockUseFlagOn = vi.mocked(useFlagOn)

describe('useServeSelfServePollsFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is enabled only when the flag is on', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: true })
    const { result } = renderHook(() => useServeSelfServePollsFlag())
    expect(result.current).toEqual({ ready: true, enabled: true })
  })

  // gp-api gates both poll routes on this key.
  it('reads the serve-self-serve-polls key', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })
    renderHook(() => useServeSelfServePollsFlag())
    expect(SERVE_SELF_SERVE_POLLS_FLAG_KEY).toBe('serve-self-serve-polls')
    expect(mockUseFlagOn).toHaveBeenCalledWith('serve-self-serve-polls', {
      trackExposure: true,
    })
  })
})
