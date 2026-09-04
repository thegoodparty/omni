import { describe, expect, it } from 'vitest'
import { RECOMMENDED_LIST_VARIANT_VALUES } from '@goodparty_org/contracts'
import {
  RECOMMENDED_LISTS_REGISTRY,
  fillCopy,
  variantsForIntent,
} from './recommendedLists.registry'
import { buildVariantFilter } from './recommendedListsUniverse.util'

describe('variantsForIntent', () => {
  it('returns one variant for introduce', () => {
    expect(variantsForIntent('introduce')).toEqual(['introNeverIded'])
  })

  it('returns three variants for persuade in display order', () => {
    expect(variantsForIntent('persuade')).toEqual([
      'persuadeAffinity',
      'persuadeIdeology',
      'persuadeUndecided',
    ])
  })

  it('covers all five intents and all thirteen variants exactly once', () => {
    const intents = [
      'introduce',
      'persuade',
      'event',
      'earlyVote',
      'electionDay',
    ] as const
    const all = intents.flatMap((intent) => variantsForIntent(intent))
    expect(all).toHaveLength(13)
    expect(new Set(all).size).toBe(13)
    expect(new Set(all)).toEqual(
      new Set(Object.keys(RECOMMENDED_LISTS_REGISTRY)),
    )
  })
})

describe('RECOMMENDED_LISTS_REGISTRY copy', () => {
  it('never says likely voters', () => {
    for (const entry of Object.values(RECOMMENDED_LISTS_REGISTRY)) {
      expect(entry.copy.criteriaSummary.toLowerCase()).not.toContain(
        'likely voter',
      )
      expect(entry.copy.title.toLowerCase()).not.toContain('likely voter')
    }
  })

  // The three variants the vote-goal size floor exempts. Pinned by name
  // because the flag is what the service reads, and cross-checked against
  // each variant's own universe below so the two cannot drift apart.
  it('marks exactly the three id-d supporter variants', () => {
    const supporters = Object.entries(RECOMMENDED_LISTS_REGISTRY)
      .filter(([, entry]) => entry.supporterBased)
      .map(([key]) => key)
      .sort()
    expect(supporters).toEqual([
      'earlyVoteSupporters',
      'electionDaySupporters',
      'eventSupporters',
    ])
  })

  // The drift guard: `supporterBased` has to agree with what the variant
  // actually asks for, which is `supportStatus` = supporter and nothing
  // else. `eventAffinity` is the near miss — its support clause includes
  // `supporter` among four values as an exclusion list, and a looser check
  // (`includes('supporter')`) would call it supporter-based and hand it a
  // floor exemption it has not earned.
  it('agrees with each variant universe about who is a supporter list', () => {
    for (const variant of RECOMMENDED_LIST_VARIANT_VALUES) {
      const filter = buildVariantFilter(variant, 'sms', 'progressive')
      const targetsSupportersOnly =
        filter?.supportStatus?.length === 1 &&
        filter.supportStatus[0] === 'supporter'
      expect({ variant, targetsSupportersOnly }).toEqual({
        variant,
        targetsSupportersOnly:
          RECOMMENDED_LISTS_REGISTRY[variant].supporterBased,
      })
    }
  })

  it('marks exactly the three ideology variants as needing a bucket', () => {
    const needing = Object.entries(RECOMMENDED_LISTS_REGISTRY)
      .filter(([, entry]) => entry.requiresIdeologyBucket)
      .map(([key]) => key)
      .sort()
    expect(needing).toEqual(
      [
        'earlyVoteIdeology',
        'electionDayIdeology',
        'eventIdeology',
        'persuadeIdeology',
      ].sort(),
    )
  })
})

describe('fillCopy', () => {
  it('fills a {bucket} token with the supplied value', () => {
    const copy = fillCopy('persuadeIdeology', { bucket: 'progressive' })
    expect(copy).toEqual({
      title: 'Voters who may lean progressive',
      criteriaSummary:
        'Moderate to high propensity voters whose behavior suggests a ' +
        'progressive lean — a hypothesis worth testing with your message.',
    })
  })

  it('leaves the token literal when no value is supplied', () => {
    const copy = fillCopy('persuadeIdeology')
    expect(copy.title).toBe('Voters who may lean {bucket}')
  })

  it('leaves the token literal when tokens omit that key', () => {
    const copy = fillCopy('persuadeIdeology', { other: 'ignored' })
    expect(copy.title).toBe('Voters who may lean {bucket}')
  })

  it('passes through copy with no tokens unchanged', () => {
    const copy = fillCopy('introNeverIded')
    expect(copy).toEqual(RECOMMENDED_LISTS_REGISTRY.introNeverIded.copy)
  })
})
