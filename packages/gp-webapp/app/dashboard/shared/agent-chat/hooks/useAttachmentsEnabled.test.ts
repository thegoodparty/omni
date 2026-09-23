import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  SERVE_CHAT_ATTACHMENTS_FLAG,
  useAttachmentsEnabled,
} from './useAttachmentsEnabled'

const useFlagOnMock = vi.fn(() => ({ ready: true, on: true }))
vi.mock('@shared/experiments/FeatureFlagsProvider', () => ({
  useFlagOn: (...args: unknown[]) => useFlagOnMock(...(args as [])),
}))

describe('useAttachmentsEnabled', () => {
  it('reads the flag with trackExposure enabled', () => {
    renderHook(() => useAttachmentsEnabled('chief_of_staff'))
    expect(useFlagOnMock).toHaveBeenCalledWith(SERVE_CHAT_ATTACHMENTS_FLAG, {
      trackExposure: true,
    })
  })

  it('is enabled only for the chief_of_staff scope', () => {
    const { result: cos } = renderHook(() =>
      useAttachmentsEnabled('chief_of_staff'),
    )
    expect(cos.current.enabled).toBe(true)
    const { result: other } = renderHook(() =>
      useAttachmentsEnabled('campaign_assistant'),
    )
    expect(other.current.enabled).toBe(false)
  })
})
