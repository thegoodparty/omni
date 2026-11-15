import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFlagOn } from './FeatureFlagsProvider'
import {
  SERVE_EMAIL_OUTREACH_FLAG_KEY,
  useServeEmailOutreachFlag,
} from './serveEmailOutreachFlag'

vi.mock('./FeatureFlagsProvider', () => ({
  useFlagOn: vi.fn(),
}))

const mockUseFlagOn = vi.mocked(useFlagOn)

describe('useServeEmailOutreachFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads the serve-email-outreach key and tracks exposure by default', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: true })

    const { result } = renderHook(() => useServeEmailOutreachFlag())

    expect(result.current).toEqual({ ready: true, enabled: true })
    expect(mockUseFlagOn).toHaveBeenCalledWith(SERVE_EMAIL_OUTREACH_FLAG_KEY, {
      trackExposure: true,
    })
    expect(SERVE_EMAIL_OUTREACH_FLAG_KEY).toBe('serve-email-outreach')
  })
})
