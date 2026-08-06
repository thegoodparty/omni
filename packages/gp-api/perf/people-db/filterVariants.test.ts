import { describe, it, expect } from 'vitest'
import { PeopleFiltersSchema } from '@goodparty_org/contracts'
import { FILTER_VARIANTS } from './filterVariants'

describe('FILTER_VARIANTS', () => {
  it('defines the six curated plan-shapes', () => {
    expect(FILTER_VARIANTS.map((v) => v.name)).toEqual([
      'none',
      'single-boolean',
      'single-multivalue',
      'broad-lowselectivity',
      'narrow-highselectivity',
      'numeric-range',
    ])
  })

  it('every payload is a valid PeopleFilters wire shape', () => {
    for (const v of FILTER_VARIANTS) {
      expect(() => PeopleFiltersSchema.parse(v.payload)).not.toThrow()
    }
  })
})
