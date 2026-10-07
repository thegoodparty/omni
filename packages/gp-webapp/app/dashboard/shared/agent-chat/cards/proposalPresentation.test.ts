import { describe, expect, it } from 'vitest'
import {
  outreachDetailHref,
  peopleCount,
  proposalListSample,
  proposalSampleLine,
} from './proposalPresentation'

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

  it('draws a widen even with no sample to size it, so the asked stay out', () => {
    expect(
      proposalListSample({
        proposalKey: KEY,
        count: 300,
        widensOutreachIds: [12],
      }),
    ).toEqual({ size: 300, seedKey: KEY, excludeOutreachIds: [12] })
  })
})

// A widen can end up holding everyone not yet asked, so it is never called
// random.
describe('proposalSampleLine', () => {
  it('calls a first sample random', () => {
    expect(
      proposalSampleLine({ channel: 'text', count: 58_520, sampleSize: 4_000 }),
    ).toBe('Text 4,000 of 58,520, picked at random')
  })

  it('says a widen reaches people not asked yet, never at random', () => {
    expect(
      proposalSampleLine({
        channel: 'text',
        count: 58_520,
        sampleSize: 2_000,
        widensOutreachIds: [12],
      }),
    ).toBe('Text up to 2,000 of the 58,520 not asked yet')
    expect(
      proposalSampleLine({
        channel: 'phoneBanking',
        count: 300,
        sampleSize: 300,
        widensOutreachIds: [12],
      }),
    ).toBe('Call everyone of the 300 not asked yet')
  })
})

describe('peopleCount', () => {
  it('counts constituents in Serve and voters in Win', () => {
    expect(peopleCount(1)).toBe('1 constituent')
    expect(peopleCount(1_200, 'serve')).toBe('1,200 constituents')
    expect(peopleCount(1, 'win')).toBe('1 voter')
    expect(peopleCount(1_200, 'win')).toBe('1,200 voters')
  })
})

describe('outreachDetailHref', () => {
  it("leads to each product's own outreach page", () => {
    expect(outreachDetailHref(7)).toBe(
      '/dashboard/constituent-outreach?outreachId=7',
    )
    expect(outreachDetailHref(7, 'win')).toBe(
      '/dashboard/outreach?outreachId=7',
    )
  })
})
