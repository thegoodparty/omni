import { describe, expect, it } from 'vitest'
import { snakeToCamelKeys } from './objects.util'

describe('snakeToCamelKeys', () => {
  it('converts every key, recursing through objects and arrays', () => {
    expect(
      snakeToCamelKeys({
        race_id: 'br-1',
        campaign_strategy_context: {
          candidate_count: 2,
          candidates: [{ full_name: 'A B', is_incumbent: true }],
        },
      }),
    ).toEqual({
      raceId: 'br-1',
      campaignStrategyContext: {
        candidateCount: 2,
        candidates: [{ fullName: 'A B', isIncumbent: true }],
      },
    })
  })

  // The params builder leaves an optional field out by setting it to undefined,
  // and the agent's schema declares it `.optional()` but not `.nullable()`. A
  // null here failed every dispatch whose campaign story read failed, or whose
  // story the byte budget dropped.
  it('drops an undefined field rather than writing null for it', () => {
    const converted = snakeToCamelKeys({
      race_id: 'br-1',
      campaign_story: undefined,
    })
    expect(converted).toEqual({ raceId: 'br-1' })
    expect(converted).not.toHaveProperty('campaignStory')
  })

  it('keeps an explicit null, which is a value the schema accepts', () => {
    expect(snakeToCamelKeys({ other_party: null })).toEqual({
      otherParty: null,
    })
  })
})
