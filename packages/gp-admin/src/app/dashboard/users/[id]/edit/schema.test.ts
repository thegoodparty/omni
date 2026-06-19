import { describe, it, expect } from 'vitest'
import { electedOfficeSchema } from './schema'

describe('electedOfficeSchema', () => {
  it('parses the editable elected-office fields', () => {
    const result = electedOfficeSchema.parse({
      electedDate: '2024-11-05',
      swornInDate: '2025-01-06',
      termStartDate: '2025-01-07',
      termEndDate: '2029-01-05',
      party: 'Independent',
    })
    expect(result.termStartDate).toBe('2025-01-07')
    expect(result.party).toBe('Independent')
  })

  it('treats all fields as optional/nullable', () => {
    const result = electedOfficeSchema.parse({})
    expect(result).toEqual({})
  })

  it('no longer accepts the derived isActive/termLengthDays fields', () => {
    // They are derived server-side from the term dates, so the form schema
    // strips them rather than persisting them.
    const result = electedOfficeSchema.parse({
      termStartDate: '2025-01-07',
      isActive: true,
      termLengthDays: 365,
    }) as Record<string, unknown>
    expect('isActive' in result).toBe(false)
    expect('termLengthDays' in result).toBe(false)
  })
})
