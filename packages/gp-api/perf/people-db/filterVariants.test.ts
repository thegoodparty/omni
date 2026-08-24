import { describe, it, expect } from 'vitest'
import { PeopleFiltersSchema } from '@goodparty_org/contracts'
import { FILTER_VARIANTS } from './filterVariants'

describe('FILTER_VARIANTS', () => {
  it('defines the curated plan-shapes', () => {
    expect(FILTER_VARIANTS.map((v) => v.name)).toEqual([
      'none',
      'single-boolean',
      'single-multivalue',
      'broad-lowselectivity',
      'narrow-highselectivity',
      'numeric-range',
      'channel-landline',
      'channel-address',
      'outreach-include',
      'outreach-exclude',
      'outreach-mixed',
    ])
  })

  it('gives every variant a human-language description', () => {
    for (const v of FILTER_VARIANTS) {
      expect(v.description.length).toBeGreaterThan(40)
      // The description is the reader-facing label in the artifact table, so
      // it must not just restate the machine name.
      expect(v.description).not.toBe(v.name)
    }
  })

  it('covers all three prior-outreach id shapes exactly once', () => {
    const shapes = FILTER_VARIANTS.filter((v) => v.idSet).map((v) => v.idSet)
    expect(shapes.sort()).toEqual(['in', 'notIn', 'overrideMixed'])
  })

  it('leaves the id-set variants payload-free so only the id clause differs', () => {
    for (const v of FILTER_VARIANTS.filter((x) => x.idSet)) {
      expect(v.payload).toEqual({})
    }
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
