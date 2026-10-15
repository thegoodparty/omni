import { describe, expect, it } from 'vitest'
import {
  COMMITTEE_NAME_PLACEHOLDER_MESSAGE,
  CommitteeNameSchema,
  isPlaceholderCommitteeName,
} from './CommitteeName.schema'

describe('isPlaceholderCommitteeName', () => {
  it.each([
    'N/A',
    ' n/a ',
    'N / A',
    'n.a.',
    'N-A',
    'NA',
    'None',
    'none.',
    'TBD',
    'self',
    'Me',
    'Not Applicable',
    'no committee',
    '----',
    '...',
    'xxx',
  ])('is true for %j', (value) => {
    expect(isPlaceholderCommitteeName(value)).toBe(true)
  })

  it.each([
    'Smith for Council',
    'Friends of Jane',
    'Benjamin Sykora for Council Member',
    'Nadia for Mayor',
    'Committee to Elect Me Too',
    'Noneck for Sheriff',
  ])('is false for %j', (value) => {
    expect(isPlaceholderCommitteeName(value)).toBe(false)
  })
})

describe('CommitteeNameSchema', () => {
  it('rejects a placeholder with the placeholder message', () => {
    const result = CommitteeNameSchema.safeParse('N/A')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        COMMITTEE_NAME_PLACEHOLDER_MESSAGE,
      )
    }
  })

  it('rejects an empty or whitespace-only name', () => {
    expect(CommitteeNameSchema.safeParse('').success).toBe(false)
    expect(CommitteeNameSchema.safeParse('   ').success).toBe(false)
  })

  it('trims and accepts a real committee name', () => {
    expect(CommitteeNameSchema.parse('  Smith for Council ')).toBe(
      'Smith for Council',
    )
  })
})
