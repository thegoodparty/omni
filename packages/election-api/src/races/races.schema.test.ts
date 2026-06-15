import { describe, expect, it } from 'vitest'
import { raceFilterSchema } from './races.schema'

describe('raceFilterSchema candidacyColumns validation', () => {
  it('rejects the email PII column', () => {
    const result = raceFilterSchema.safeParse({ candidacyColumns: 'id,email' })
    expect(result.success).toBe(false)
  })

  it('accepts valid candidacy columns', () => {
    // firstName/lastName exist on Candidacy but NOT on Place — under the old
    // (buggy) placeColumns check these were wrongly rejected. This asserts the
    // validator now uses the candidacy allowlist.
    const result = raceFilterSchema.safeParse({
      candidacyColumns: 'id,firstName,lastName',
    })
    expect(result.success).toBe(true)
  })
})
