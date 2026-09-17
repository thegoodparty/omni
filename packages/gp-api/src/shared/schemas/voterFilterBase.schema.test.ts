import { describe, expect, it } from 'vitest'
import { PLACE_WORDS } from '@/chats/general/crm-tools/crudSavedFilters.tool'
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

  // Trip wire for crudSavedFilters.tool.ts's isUnfilteredPlaceName, which
  // assumes precincts is the only field that makes a place name (county,
  // city, zip, ...) an honest geographic narrowing. If this ever fails, a
  // new field represents one of those place words: update PLACE_WORDS'
  // assumption and the saved-list name guard together, in the same change.
  it('has no field named after a place word other than precincts', () => {
    const splitCamelCase = (key: string) =>
      key.split(/(?=[A-Z])/).map((word) => word.toLowerCase())
    const flagged = Object.keys(voterFilterBaseSchema.shape).filter((key) =>
      splitCamelCase(key).some((word) => PLACE_WORDS.includes(word)),
    )
    expect(flagged).toEqual([])
  })
})
