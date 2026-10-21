import { describe, expect, it } from 'vitest'
import {
  officeHolderColumns,
  officeHolderFilterSchema,
} from './officeHolders.schema'

describe('officeHolderFilterSchema', () => {
  it('exposes office columns for column selection', () => {
    expect(officeHolderColumns).toEqual(
      expect.arrayContaining(['id', 'personId', 'positionName', 'partyNames']),
    )
  })

  it('rejects a non-UUID personId', () => {
    expect(
      officeHolderFilterSchema.safeParse({ personId: 'nope' }).success,
    ).toBe(false)
  })

  it('rejects an unknown column', () => {
    expect(
      officeHolderFilterSchema.safeParse({ columns: 'id,notAColumn' }).success,
    ).toBe(false)
  })

  it('accepts a valid personId filter with coerced flags', () => {
    const result = officeHolderFilterSchema.parse({
      personId: '22222222-2222-2222-2222-222222222222',
      includePosition: 'true',
    })
    expect(result.includePosition).toBe(true)
  })
})
