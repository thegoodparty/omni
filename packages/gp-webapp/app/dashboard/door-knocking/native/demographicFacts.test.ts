import { describe, expect, it } from 'vitest'
import { RoutePayloadTarget } from '@goodparty_org/contracts'
import {
  demographicFacts,
  incomeRangeLabel,
  NOT_ON_FILE,
  voterDemographicFacts,
} from './demographicFacts'

const target = (
  overrides: Partial<RoutePayloadTarget> = {},
): RoutePayloadTarget => ({
  stopTargetId: 21,
  personId: 'person-1',
  name: 'Dorian Fen',
  age: 31,
  politicalParty: 'Independent',
  cellPhone: null,
  landline: null,
  knockStatus: 'unknown',
  mayHaveMoved: false,
  doNotKnock: false,
  ...overrides,
})

// Both cards, searched as one profile: the split between them is a layout
// decision, and a label moving across it should not need every assertion below
// rewritten to follow.
const valueFor = (label: string, overrides: Partial<RoutePayloadTarget> = {}) =>
  [
    ...voterDemographicFacts(target(overrides)),
    ...demographicFacts(target(overrides)),
  ].find((fact) => fact.label === label)?.value

describe('incomeRangeLabel', () => {
  // A modelled figure printed to the dollar implies a measurement nobody took,
  // so it is bucketed with the same vocabulary the CRM's income filter offers.
  it.each([
    [12000, 'Under $25k'],
    [25000, '$25k - $35k'],
    [82000, '$75k - $100k'],
    [199999, '$150k - $200k'],
    [1200000, '$200k+'],
  ])('buckets %i as %s', (amount, label) => {
    expect(incomeRangeLabel(amount)).toBe(label)
  })

  // Boundaries, because the mapping's ranges are inclusive on both ends and an
  // off-by-one here silently moves people between buckets.
  it.each([
    [24999, 'Under $25k'],
    [200000, '$200k+'],
  ])('puts the boundary value %i in %s', (amount, label) => {
    expect(incomeRangeLabel(amount)).toBe(label)
  })

  // Zero reads as absent, following the CRM overlay's own rule: a modelled
  // household income of exactly $0 is a placeholder far more often than a
  // finding, and "Under $25k" would state it as one.
  it.each([null, undefined, 0, -1])('treats %s as no answer', (amount) => {
    expect(incomeRangeLabel(amount)).toBeNull()
  })
})

// The canvas splits the profile into a voter-file card and a personal one, so
// the two lists are asserted separately — a field drifting from one to the
// other is the defect this pair exists to catch.
describe('voterDemographicFacts', () => {
  it('returns the registration facts the canvas puts in that card', () => {
    expect(voterDemographicFacts(target()).map((fact) => fact.label)).toEqual([
      'Registered voter',
      'Turnout likelihood',
      'Political party',
    ])
  })

  // Not the canvas's "Voter status", which means active-or-inactive
  // registration. This column is turnout propensity and we hold nothing that
  // answers the canvas's question.
  it('names the turnout column for what it holds', () => {
    const labels = voterDemographicFacts(target()).map((fact) => fact.label)
    expect(labels).toContain('Turnout likelihood')
    expect(labels).not.toContain('Voter status')
  })

  // Party rode the sheet's header subtitle before it joined this card; it is a
  // voter-file attribute like the two beside it.
  it('states the party, and says nothing when the file has none', () => {
    expect(valueFor('Political party', { politicalParty: 'Democratic' })).toBe(
      'Democratic',
    )
    expect(valueFor('Political party', { politicalParty: null })).toBe(
      NOT_ON_FILE,
    )
  })
})

describe('demographicFacts', () => {
  it('returns the personal attributes in the order product asked for', () => {
    expect(demographicFacts(target()).map((fact) => fact.label)).toEqual([
      'Marital status',
      'Has children under 18',
      'Veteran status',
      'Homeowner',
      'Business owner',
      'Level of education',
      'Estimated household income',
      'Language',
      'Ethnicity group',
    ])
  })

  // One decision about absence, applied across both cards. A profile where some
  // fields say "Unknown", some say "No" and some vanish teaches a reader that
  // absence means something different each time — and splitting the card in two
  // is exactly the moment two vocabularies could creep in.
  it('renders every absent attribute identically, on both cards', () => {
    const empty = target({ politicalParty: null })
    expect(
      [...voterDemographicFacts(empty), ...demographicFacts(empty)].every(
        (fact) => fact.value === NOT_ON_FILE,
      ),
    ).toBe(true)
  })

  // These two columns hold a value meaning yes or nothing at all, so absence is
  // indistinguishable from unknown. "No" would be a claim the data cannot
  // support, and the contract's z.enum(['Yes']) is what leaves no third branch.
  it.each([
    ['Veteran status', 'veteranStatus'],
    ['Business owner', 'businessOwner'],
  ] as const)('never says No for an absent %s', (label, field) => {
    expect(valueFor(label, { [field]: null })).toBe(NOT_ON_FILE)
    expect(valueFor(label, { [field]: 'Yes' })).toBe('Yes')
  })

  // `registeredVoter` is a real boolean off `StateVoterID IS NOT NULL`, so it
  // does have an honest No — the distinction the two presence-only columns
  // above cannot make.
  it('reports a known registration answer either way', () => {
    expect(valueFor('Registered voter', { registeredVoter: true })).toBe('Yes')
    expect(valueFor('Registered voter', { registeredVoter: false })).toBe('No')
  })

  // The route payload's demographic keys are optional so a walk snapshotted
  // offline before they shipped still parses on a phone that cannot refetch.
  // Nothing parses this payload in the webapp, so the key is simply missing —
  // and a bare ternary would make undefined false and print "No" here.
  it('treats a missing registration key as no answer, not as No', () => {
    expect(valueFor('Registered voter')).toBe(NOT_ON_FILE)
  })

  it('passes the server-mapped display values straight through', () => {
    expect(
      valueFor('Marital status', { maritalStatus: 'Likely Married' }),
    ).toBe('Likely Married')
    expect(
      valueFor('Level of education', { levelOfEducation: 'Graduate Degree' }),
    ).toBe('Graduate Degree')
    expect(valueFor('Homeowner', { homeowner: 'Homeowner' })).toBe('Homeowner')
  })
})
