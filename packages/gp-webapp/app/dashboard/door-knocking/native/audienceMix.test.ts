import { describe, expect, it } from 'vitest'
import type { RoutePayloadTarget } from '@goodparty_org/contracts'
import { ageBucketLabel, routeAudienceMix } from './audienceMix'

// `ageBucket` is a deliberate duplicate of gp-api's `encodeAge` — the encoder
// is a server module, so it cannot be imported here, and the comment in
// audienceMix.ts says the two MUST agree. A duplicate with no test is a
// duplicate that drifts, and the drift is invisible: an unknocked list would be
// bucketed by the pack (the encoder's work) and the same list after knocking by
// this copy, so a divergence re-shapes a list's own age breakdown as a reward
// for walking it. These are the encoder's bounds, hardcoded on purpose — the
// test's whole job is to fail if either copy moves.
const target = (age: number | null): RoutePayloadTarget =>
  ({
    stopTargetId: 1,
    personId: 'person-1',
    name: 'Dorian Fen',
    age,
    politicalParty: null,
    cellPhone: null,
    landline: null,
    mayHaveMoved: false,
    knockStatus: 'unknown',
    doNotKnock: false,
  }) as RoutePayloadTarget

const bucketFor = (age: number | null) =>
  routeAudienceMix([target(age)]).ageMix[0]?.label

describe('routeAudienceMix age buckets', () => {
  // Shared edges resolve to the YOUNGER bucket in the encoder (`age <= 25`
  // before `age <= 35`), so every boundary is checked on both sides.
  it.each([
    [18, '18_25'],
    [25, '18_25'],
    [26, '25_35'],
    [35, '25_35'],
    [36, '35_50'],
    [50, '35_50'],
    [51, '50_plus'],
    [104, '50_plus'],
  ])('buckets age %i as %s', (age, expected) => {
    expect(bucketFor(age)).toBe(expected)
  })

  // No age filter matches an under-18 row, so no pack bucket may either — the
  // encoder's rule, and the reason this is not its own "under 18" bucket.
  it.each([[null], [17], [0]])('reads %s as Unknown', (age) => {
    expect(bucketFor(age)).toBe('Unknown')
  })

  it('counts people into buckets, biggest first', () => {
    const { ageMix } = routeAudienceMix([target(40), target(70), target(45)])

    expect(ageMix).toEqual([
      { label: '35_50', people: 2 },
      { label: '50_plus', people: 1 },
    ])
  })
})

describe('routeAudienceMix party buckets', () => {
  // A live target with no row behind it carries a null party, and that is
  // genuinely unknown rather than 'Other' — which means a party we hold that
  // isn't one of the ruled three.
  it('reads a missing party as Unknown, not Other', () => {
    const { partyMix } = routeAudienceMix([target(30)])

    expect(partyMix).toEqual([{ label: 'Unknown', people: 1 }])
  })

  it('counts parties into buckets, biggest first', () => {
    const { partyMix } = routeAudienceMix([
      { ...target(30), politicalParty: 'Republican' } as RoutePayloadTarget,
      { ...target(30), politicalParty: 'Democratic' } as RoutePayloadTarget,
      { ...target(30), politicalParty: 'Democratic' } as RoutePayloadTarget,
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
  it('turns the encoder keys into prose', () => {
    expect(ageBucketLabel('18_25')).toBe('18–25')
    expect(ageBucketLabel('50_plus')).toBe('50+')
    expect(ageBucketLabel('Unknown')).toBe('Unknown')
  })

  // A bucket the encoder gains before this map does must still render as
  // something, rather than blanking a row in the breakdown.
  it('passes an unrecognised key through unchanged', () => {
    expect(ageBucketLabel('65_plus')).toBe('65_plus')
  })
})
