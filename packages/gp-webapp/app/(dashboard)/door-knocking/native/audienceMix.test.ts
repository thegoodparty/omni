import { describe, expect, it } from 'vitest'
import type { RoutePayloadTarget } from '@goodparty_org/contracts'
import { ageBucketLabel, groupAgeSlices, routeAudienceMix } from './audienceMix'

// A frozen route's targets are bucketed here and an unknocked list's people
// are bucketed by gp-api's encoder, so the two MUST agree or a list re-shapes
// its own age breakdown as a reward for being walked. Both now read contracts'
// one table, and these are the bounds that table encodes.
const target = (
  age: number | null,
  politicalParty: string | null = null,
): RoutePayloadTarget =>
  ({
    stopTargetId: 1,
    personId: 'person-1',
    name: 'Dorian Fen',
    age,
    politicalParty,
    cellPhone: null,
    landline: null,
    mayHaveMoved: false,
    knockStatus: 'unknown',
    doNotKnock: false,
  }) as RoutePayloadTarget

const bucketFor = (age: number | null) =>
  routeAudienceMix([target(age)]).ageMix[0]?.label

describe('routeAudienceMix age buckets', () => {
  // The current generation's bands, checked on both sides of every boundary.
  // These are display bands: the pack's own buckets are finer (it cuts at the
  // retired generation's edges too), and both sides roll up to these.
  it.each([
    [18, '18_24'],
    [24, '18_24'],
    [25, '25_34'],
    [34, '25_34'],
    [35, '35_49'],
    [49, '35_49'],
    [50, '50_64'],
    [64, '50_64'],
    [65, '65_plus'],
    [104, '65_plus'],
  ])('reads %s as %s', (age, bucket) => {
    expect(bucketFor(age)).toBe(bucket)
  })

  // No age filter matches an under-18 row, so no pack bucket may either — the
  // encoder's rule, and the reason this is not its own "under 18" bucket.
  it.each([[null], [17], [0]])('reads %s as Unknown', (age) => {
    expect(bucketFor(age)).toBe('Unknown')
  })

  it('counts people into buckets, biggest first', () => {
    const { ageMix } = routeAudienceMix([target(40), target(70), target(45)])

    expect(ageMix).toEqual([
      { label: '35_49', people: 2 },
      { label: '65_plus', people: 1 },
    ])
  })
})

// The pack's buckets are cut so every saved-list age key maps onto them
// exactly, which costs three single-year buckets (25, 35, 50). Nobody should
// be shown a one-year slice beside a fourteen-year one, so a breakdown rolls
// them up first.
describe('groupAgeSlices', () => {
  it('folds the single-year buckets into their bands', () => {
    expect(
      groupAgeSlices([
        { label: '25', people: 3 },
        { label: '26_34', people: 40 },
        { label: '18_24', people: 10 },
      ]),
    ).toEqual([
      { label: '25_34', people: 43 },
      { label: '18_24', people: 10 },
    ])
  })

  // Summing changes which bucket is biggest, so the sort has to happen after.
  it('re-sorts after summing', () => {
    expect(
      groupAgeSlices([
        { label: '18_24', people: 30 },
        { label: '35', people: 20 },
        { label: '36_49', people: 20 },
      ]),
    ).toEqual([
      { label: '35_49', people: 40 },
      { label: '18_24', people: 30 },
    ])
  })

  it('leaves Unknown alone', () => {
    expect(groupAgeSlices([{ label: 'Unknown', people: 5 }])).toEqual([
      { label: 'Unknown', people: 5 },
    ])
  })

  // A pack built before the re-cut still ships the legacy buckets, and a
  // browser can hold one across a deploy. They are already displayable bands;
  // mapping them onto the new ones would re-shape a real breakdown.
  it('passes a pre-re-cut pack’s buckets through', () => {
    expect(
      groupAgeSlices([
        { label: '35_50', people: 7 },
        { label: '50_plus', people: 9 },
      ]),
    ).toEqual([
      { label: '50_plus', people: 9 },
      { label: '35_50', people: 7 },
    ])
  })
})

describe('routeAudienceMix party buckets', () => {
  // A live target with no row behind it carries a null party, and that is
  // genuinely unknown rather than 'Other'.
  it('reads a null party as Unknown', () => {
    expect(routeAudienceMix([target(40, null)]).partyMix).toEqual([
      { label: 'Unknown', people: 1 },
    ])
  })

  it('counts people into parties, biggest first', () => {
    const { partyMix } = routeAudienceMix([
      target(40, 'Democratic'),
      target(41, 'Republican'),
      target(42, 'Democratic'),
    ])

    expect(partyMix).toEqual([
      { label: 'Democratic', people: 2 },
      { label: 'Republican', people: 1 },
    ])
  })
})

describe('ageBucketLabel', () => {
  // The pack ships raw bucket keys; only presentation turns them into prose,
  // so both branches of the sheet can share one formatter.
  it('turns the band keys into prose', () => {
    expect(ageBucketLabel('18_24')).toBe('18–24')
    expect(ageBucketLabel('50_64')).toBe('50–64')
    expect(ageBucketLabel('65_plus')).toBe('65+')
    expect(ageBucketLabel('Unknown')).toBe('Unknown')
  })

  // A pre-re-cut pack's buckets reach the sheet ungrouped, so they still need
  // prose of their own rather than rendering as raw keys.
  it('still speaks the pre-re-cut vocabulary', () => {
    expect(ageBucketLabel('18_25')).toBe('18–25')
    expect(ageBucketLabel('50_plus')).toBe('50+')
  })

  // A bucket the encoder gains before this map does must still render as
  // something, rather than blanking a row in the breakdown.
  it('passes an unrecognised key through unchanged', () => {
    expect(ageBucketLabel('105_plus')).toBe('105_plus')
  })
})
