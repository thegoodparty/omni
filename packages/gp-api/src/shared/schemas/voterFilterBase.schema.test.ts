import { describe, expect, it } from 'vitest'
import { voterFilterBaseSchema } from './voterFilterBase.schema'

describe('voterFilterBaseSchema', () => {
  // Regression for ENG-10543: a persisted VoterFileFilter row stores
  // search=null when no search was saved, and the FE spreads the whole row
  // back into this schema (POST /p2p/phone-list). z.string().optional()
  // rejected null and 400'd the texting flow; nullish accepts it.
  it('accepts a null search (persisted row with no saved search)', () => {
    const result = voterFilterBaseSchema.safeParse({
      audienceSuperVoters: false,
      partyIndependent: true,
      languageCodes: [],
      voterStatus: [],
      incomeRanges: [],
      search: null,
    })

    expect(result.success).toBe(true)
  })

  it('still accepts a string search', () => {
    expect(voterFilterBaseSchema.safeParse({ search: 'smith' }).success).toBe(
      true,
    )
  })

  it('still accepts an omitted search', () => {
    expect(voterFilterBaseSchema.safeParse({}).success).toBe(true)
  })
})
