import { describe, expect, it } from 'vitest'
import { proposalListSample } from './proposalPresentation'

const KEY = '3f2c1a90-1111-4222-8333-444455556666'

describe('proposalListSample', () => {
  it('draws the list as the sample, keyed on the proposal', () => {
    expect(
      proposalListSample({
        proposalKey: KEY,
        count: 58_520,
        sampleSize: 4_000,
      }),
    ).toEqual({ size: 4_000, seedKey: KEY })
  })

  it('leaves out who the sends it widens already reached', () => {
    expect(
      proposalListSample({
        proposalKey: KEY,
        count: 58_520,
        sampleSize: 2_000,
        widensOutreachIds: [12, 13],
      }),
    ).toEqual({ size: 2_000, seedKey: KEY, excludeOutreachIds: [12, 13] })
  })

  it('saves the live list when there is no sample, or it covers everyone', () => {
    expect(proposalListSample({ proposalKey: KEY, count: 300 })).toBeUndefined()
    expect(
      proposalListSample({ proposalKey: KEY, count: 300, sampleSize: 300 }),
    ).toBeUndefined()
  })
})
