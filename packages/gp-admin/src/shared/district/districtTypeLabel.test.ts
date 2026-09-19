import { describe, it, expect } from 'vitest'
import { districtTypeLabel } from './districtTypeLabel'

describe('districtTypeLabel', () => {
  it('names the lower chamber the way the state does', () => {
    expect(districtTypeLabel('State_House_District', 'CA')).toBe(
      'State Assembly District'
    )
    expect(districtTypeLabel('State_House_District', 'NJ')).toBe(
      'General Assembly District'
    )
    expect(districtTypeLabel('State_House_District', 'VA')).toBe(
      'House of Delegates District'
    )
  })

  it('accepts a lowercase state', () => {
    expect(districtTypeLabel('State_House_District', 'ca')).toBe(
      'State Assembly District'
    )
  })

  it('keeps the humanized type for states that do call it a House', () => {
    expect(districtTypeLabel('State_House_District', 'TX')).toBe(
      'State House District'
    )
  })

  // The default branch is what stops this map from silently blanking or
  // mislabeling the hundreds of other L2 types, or a district with no state.
  it('falls back to the humanized type for other types and missing states', () => {
    expect(districtTypeLabel('State_Senate_District', 'CA')).toBe(
      'State Senate District'
    )
    expect(districtTypeLabel('County_Supervisorial_District', 'CA')).toBe(
      'County Supervisorial District'
    )
    expect(districtTypeLabel('State_House_District', null)).toBe(
      'State House District'
    )
    expect(districtTypeLabel('State_House_District', undefined)).toBe(
      'State House District'
    )
  })

  it('renders nothing when there is no type', () => {
    expect(districtTypeLabel(null, 'CA')).toBe('')
    expect(districtTypeLabel(undefined, 'CA')).toBe('')
  })
})
