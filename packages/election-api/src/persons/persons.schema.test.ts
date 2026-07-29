import { describe, expect, it } from 'vitest'
import {
  personColumns,
  personFilterSchema,
  PERSON_PII_COLUMNS,
} from './persons.schema'

describe('person column allowlist', () => {
  it('excludes email and phone (PII) from the selectable columns', () => {
    expect(PERSON_PII_COLUMNS).toContain('email')
    expect(PERSON_PII_COLUMNS).toContain('phone')
    expect(personColumns).not.toContain('email')
    expect(personColumns).not.toContain('phone')
  })

  it('still allows non-PII person columns', () => {
    expect(personColumns).toEqual(
      expect.arrayContaining([
        'id',
        'slug',
        'firstName',
        'lastName',
        'bioText',
      ]),
    )
  })
})

describe('personFilterSchema', () => {
  it('rejects a columns request that includes a PII field', () => {
    expect(personFilterSchema.safeParse({ columns: 'id,email' }).success).toBe(
      false,
    )
    expect(personFilterSchema.safeParse({ columns: 'id,phone' }).success).toBe(
      false,
    )
  })

  it('rejects a non-UUID personId', () => {
    expect(
      personFilterSchema.safeParse({ personId: 'not-a-uuid' }).success,
    ).toBe(false)
  })

  it('accepts a valid UUID personId and non-PII columns', () => {
    const result = personFilterSchema.safeParse({
      personId: '11111111-1111-1111-1111-111111111111',
      columns: 'id,slug,firstName',
    })
    expect(result.success).toBe(true)
  })

  it('parses a comma-separated ids list into an array', () => {
    const a = '11111111-1111-1111-1111-111111111111'
    const b = '22222222-2222-2222-2222-222222222222'
    const result = personFilterSchema.safeParse({ ids: `${a}, ${b}` })
    expect(result.success).toBe(true)
    expect(result.data?.ids).toEqual([a, b])
  })

  it('rejects an ids list containing a non-UUID', () => {
    expect(personFilterSchema.safeParse({ ids: 'not-a-uuid' }).success).toBe(
      false,
    )
  })

  it('coerces include flags to booleans with false defaults', () => {
    const result = personFilterSchema.parse({})
    expect(result.includeOfficeHolders).toBe(false)
    expect(result.includeCandidacies).toBe(false)
  })
})
