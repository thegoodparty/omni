import { describe, it, expect } from 'vitest'
import { PeopleFiltersSchema } from '@goodparty_org/contracts'
import { FILTER_VARIANTS } from './filterVariants'

describe('FILTER_VARIANTS', () => {
  it('defines the eight curated plan-shapes', () => {
    expect(FILTER_VARIANTS.map((v) => v.name)).toEqual([
      'none',
      'single-boolean',
      'single-multivalue',
      'broad-lowselectivity',
      'narrow-highselectivity',
      'numeric-range',
      'channel-landline',
      'channel-address',
    ])
  })

  it('covers all three list-detail reachability channels', () => {
    // ContactsService.fetchListDetailAggregates fans out to exactly these
    // three channel-restricted getAggregates calls on top of the base one.
    const payloads = FILTER_VARIANTS.map((v) => v.payload)
    expect(payloads).toContainEqual({ hasCellPhone: true })
    expect(payloads).toContainEqual({ hasLandline: true })
    expect(payloads).toContainEqual({ hasAddress: true })
  })

  it('every payload is a valid PeopleFilters wire shape', () => {
    for (const v of FILTER_VARIANTS) {
      expect(() => PeopleFiltersSchema.parse(v.payload)).not.toThrow()
    }
  })
})
