import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFlagOn } from './FeatureFlagsProvider'
import {
  PRO_UPGRADE_ENTRY_PATH,
  useProUpgradeEntryHref,
} from './proUpgrade3Flag'

vi.mock('./FeatureFlagsProvider', () => ({
  useFlagOn: vi.fn(),
}))

const mockUseFlagOn = vi.mocked(useFlagOn)

const LEGACY_HREF = '/dashboard/pro-sign-up'

describe('useProUpgradeEntryHref', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes the cohort to the new wizard once the flag resolves on', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: true })

    const { result } = renderHook(() => useProUpgradeEntryHref(LEGACY_HREF))

    expect(result.current).toEqual({
      ready: true,
      href: PRO_UPGRADE_ENTRY_PATH,
    })
  })

  it('keeps the off-cohort caller on its legacy destination', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    const { result } = renderHook(() => useProUpgradeEntryHref(LEGACY_HREF))

    expect(result.current).toEqual({ ready: true, href: LEGACY_HREF })
  })

  it('defaults to the new wizard while the flag is still resolving', () => {
    mockUseFlagOn.mockReturnValue({ ready: false, on: false })

    const { result } = renderHook(() => useProUpgradeEntryHref(LEGACY_HREF))

    // A cohort user must never be sent to the legacy flow during the resolve
    // window, so the unresolved default is the new wizard, not offCohortHref.
    expect(result.current).toEqual({
      ready: false,
      href: PRO_UPGRADE_ENTRY_PATH,
    })
  })
})
