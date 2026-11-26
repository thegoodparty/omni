import { describe, expect, it } from 'vitest'
import { DoorKnockingCampaignResultsSchema } from './DoorKnockingCampaignResults.schema'

const results = {
  doorsKnocked: 40,
  byOutcome: {
    answered: 12,
    not_home: 25,
    refused_to_engage: 2,
    inaccessible: 1,
    not_a_voter: 0,
  },
  bySupport: { supporter: 6, unsure: 3, non_supporter: 3 },
  byWillVote: { yes: 8, no: 2, unsure: 1, already_voted: 1 },
  byFollowUp: { yes: 0, no: 0 },
}

describe('DoorKnockingCampaignResultsSchema', () => {
  it('accepts a full set of outcome and answer counts', () => {
    expect(() => DoorKnockingCampaignResultsSchema.parse(results)).not.toThrow()
  })

  // The drawer reads every key directly, so a missing one is refused here
  // rather than rendering as an empty row.
  it('requires every key of each tally', () => {
    for (const partial of [
      { byOutcome: { answered: 1 } },
      { bySupport: { supporter: 1 } },
      { byWillVote: { yes: 1 } },
      { byFollowUp: { yes: 1 } },
    ]) {
      expect(() =>
        DoorKnockingCampaignResultsSchema.parse({ ...results, ...partial }),
      ).toThrow()
    }
  })
})
