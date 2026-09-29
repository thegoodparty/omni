import { describe, expect, it } from 'vitest'
import {
  candidacyColumns,
  candidacyFilterSchema,
  CANDIDACY_PII_COLUMNS,
} from './candidacies.schema'

describe('candidacy column allowlist', () => {
  it('excludes email (PII) from the selectable columns', () => {
    expect(CANDIDACY_PII_COLUMNS).toContain('email')
    expect(candidacyColumns).not.toContain('email')
  })

  it('still allows non-PII candidacy columns', () => {
    expect(candidacyColumns).toEqual(
      expect.arrayContaining(['id', 'slug', 'firstName', 'lastName']),
    )
  })
})

describe('candidacyFilterSchema columns validation', () => {
  it('rejects a columns request that includes the email PII field', () => {
    const result = candidacyFilterSchema.safeParse({ columns: 'id,email' })
    expect(result.success).toBe(false)
  })

  it('rejects email even when whitespace-padded', () => {
    const result = candidacyFilterSchema.safeParse({ columns: 'id, email ' })
    expect(result.success).toBe(false)
  })

  it('accepts a columns request of only non-PII fields', () => {
    const result = candidacyFilterSchema.safeParse({
      columns: 'id,firstName,lastName',
    })
    expect(result.success).toBe(true)
  })
})
