import { describe, expect, it } from 'vitest'
import {
  RECOMMENDED_LIST_VARIANT_INTENT,
  RECOMMENDED_LIST_VARIANT_VALUES,
} from '@goodparty_org/contracts'
import {
  builderFiltersFromRecommendation,
  intentForOutreachPurpose,
  purposeForRecommendedVariant,
} from './recommendedListMapping.util'

describe('purposeForRecommendedVariant', () => {
  it('answers the purpose step with the variant’s own intent, round-tripping the purpose map', () => {
    for (const variant of RECOMMENDED_LIST_VARIANT_VALUES) {
      expect(
        intentForOutreachPurpose(purposeForRecommendedVariant(variant)),
      ).toBe(RECOMMENDED_LIST_VARIANT_INTENT[variant])
    }
  })

  it('names the shared purpose slugs', () => {
    expect(purposeForRecommendedVariant('introNeverIded')).toBe(
      'introduce_myself',
    )
    expect(purposeForRecommendedVariant('persuadeAffinity')).toBe(
      'persuade_voters',
    )
    expect(purposeForRecommendedVariant('eventSupporters')).toBe('event_invite')
    expect(purposeForRecommendedVariant('earlyVoteAffinity')).toBe(
      'early_voting',
    )
    expect(purposeForRecommendedVariant('electionDayIdeology')).toBe(
      'election_day_turnout',
    )
  })
})

describe('intentForOutreachPurpose', () => {
  it('maps every non-custom purpose onto its recommended-list intent', () => {
    expect(intentForOutreachPurpose('introduce_myself')).toBe('introduce')
    expect(intentForOutreachPurpose('persuade_voters')).toBe('persuade')
    expect(intentForOutreachPurpose('event_invite')).toBe('event')
    expect(intentForOutreachPurpose('early_voting')).toBe('earlyVote')
    expect(intentForOutreachPurpose('election_day_turnout')).toBe('electionDay')
  })

  it('gives custom no intent', () => {
    expect(intentForOutreachPurpose('custom')).toBeNull()
  })
})

describe('builderFiltersFromRecommendation', () => {
  it('maps voter-status bands onto the audience builder keys', () => {
    expect(
      builderFiltersFromRecommendation({
        voterStatus: ['Super', 'Likely'],
      }),
    ).toEqual({
      audienceSuperVoters: true,
      audienceLikelyVoters: true,
    })
  })

  it('carries affinity, ideology and phone dimensions', () => {
    expect(
      builderFiltersFromRecommendation({
        independentAffinity: true,
        ideologyConservative: true,
        hasCellPhone: true,
        hasAnyPhone: true,
      }),
    ).toEqual({
      independentAffinity: true,
      ideologyConservative: true,
      hasCellPhone: true,
      hasAnyPhone: true,
    })
  })

  it('sets no key for a dimension the filter leaves unset', () => {
    // A mutation that flips this to `result[key] = !!filter.independentAffinity`
    // would start emitting an explicit `false`, which is a real behavior change
    // for a caller merging this into an existing draft — this pins "absent",
    // not merely falsy.
    const result = builderFiltersFromRecommendation({})
    expect(result).toEqual({})
    expect('independentAffinity' in result).toBe(false)
  })

  it('ignores an unrecognized voter-status value', () => {
    expect(
      builderFiltersFromRecommendation({ voterStatus: ['NotAStatus'] }),
    ).toEqual({})
  })
})
