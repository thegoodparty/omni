import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDistrictResolution } from './useDistrictResolution'

const mockOrg = vi.hoisted(() => ({ current: undefined as unknown }))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => mockOrg.current,
}))

describe('useDistrictResolution', () => {
  it('reports unresolvable when district is null', () => {
    mockOrg.current = {
      slug: 'campaign-1',
      positionName: 'Mayor',
      district: null,
    }

    const { result } = renderHook(() => useDistrictResolution())

    expect(result.current.isUnresolvable).toBe(true)
    expect(result.current.officeName).toBe('Mayor')
    expect(result.current.organizationSlug).toBe('campaign-1')
  })

  it('reports resolvable when a district is present', () => {
    mockOrg.current = {
      slug: 'campaign-1',
      positionName: 'Mayor',
      district: { id: 'd1', l2Type: 'City', l2Name: 'Austin' },
    }

    const { result } = renderHook(() => useDistrictResolution())

    expect(result.current.isUnresolvable).toBe(false)
  })

  // Every gated surface would flash its empty state on first paint if an
  // unsettled org list read as unavailable.
  it('does not report unresolvable while the org is undefined', () => {
    mockOrg.current = undefined

    const { result } = renderHook(() => useDistrictResolution())

    expect(result.current.isUnresolvable).toBe(false)
    expect(result.current.officeName).toBeNull()
    expect(result.current.organizationSlug).toBeUndefined()
  })

  // Strict === null: Organization declares district as a required nullable key,
  // so an absent field falls back to asking the server rather than hiding a page
  // that might work.
  it('does not report unresolvable when district is absent entirely', () => {
    mockOrg.current = { slug: 'campaign-1', positionName: 'Mayor' }

    const { result } = renderHook(() => useDistrictResolution())

    expect(result.current.isUnresolvable).toBe(false)
  })

  it('reports a null office name when the org has none', () => {
    mockOrg.current = {
      slug: 'eo-1',
      positionName: null,
      district: null,
    }

    const { result } = renderHook(() => useDistrictResolution())

    expect(result.current.isUnresolvable).toBe(true)
    expect(result.current.officeName).toBeNull()
  })
})
