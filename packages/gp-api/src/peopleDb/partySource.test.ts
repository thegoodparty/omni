import { describe, expect, it } from 'vitest'
import { partyProvenanceForState, partySourceForState } from './partySource'

// L2, "State by State Partisanship (Party)", September 2024.
const MODELED = ['AL', 'HI', 'MN', 'MO', 'MT', 'ND', 'VT', 'WI']
const PRIMARY_BALLOT = [
  'GA',
  'IL',
  'IN',
  'MI',
  'MS',
  'OH',
  'SC',
  'TN',
  'TX',
  'VA',
  'WA',
]

describe('partySourceForState', () => {
  it('names the states where L2 models every party value', () => {
    for (const state of MODELED) {
      expect(partySourceForState(state), state).toBe('modeled')
    }
  })

  it('names the states where L2 assigns party from primary ballots', () => {
    for (const state of PRIMARY_BALLOT) {
      expect(partySourceForState(state), state).toBe('primary_ballot')
    }
  })

  it('treats every other state and DC as a registration', () => {
    const all = [
      'AL',
      'AK',
      'AZ',
      'AR',
      'CA',
      'CO',
      'CT',
      'DC',
      'DE',
      'FL',
      'GA',
      'HI',
      'ID',
      'IL',
      'IN',
      'IA',
      'KS',
      'KY',
      'LA',
      'ME',
      'MD',
      'MA',
      'MI',
      'MN',
      'MS',
      'MO',
      'MT',
      'NE',
      'NV',
      'NH',
      'NJ',
      'NM',
      'NY',
      'NC',
      'ND',
      'OH',
      'OK',
      'OR',
      'PA',
      'RI',
      'SC',
      'SD',
      'TN',
      'TX',
      'UT',
      'VT',
      'VA',
      'WA',
      'WV',
      'WI',
      'WY',
    ]
    expect(all).toHaveLength(51)
    const registered = all.filter(
      (state) => !MODELED.includes(state) && !PRIMARY_BALLOT.includes(state),
    )
    expect(registered).toHaveLength(32)
    for (const state of registered) {
      expect(partySourceForState(state), state).toBe('registration')
    }
  })

  it('accepts a lower-case or padded code and rejects anything else', () => {
    expect(partySourceForState('mn')).toBe('modeled')
    expect(partySourceForState(' ga ')).toBe('primary_ballot')
    expect(partySourceForState(null)).toBeNull()
    expect(partySourceForState(undefined)).toBeNull()
    expect(partySourceForState('')).toBeNull()
    expect(partySourceForState('PR')).toBeNull()
    expect(partySourceForState('Minnesota')).toBeNull()
  })
})

describe('partyProvenanceForState', () => {
  it('maps a registration to observed and the rest to modeled', () => {
    expect(partyProvenanceForState('CA')?.provenance).toBe('observed')
    expect(partyProvenanceForState('GA')?.provenance).toBe('modeled')
    expect(partyProvenanceForState('MN')?.provenance).toBe('modeled')
  })

  it('states the source, naming the state and only ever "the vendor"', () => {
    expect(partyProvenanceForState('MN')?.sentence).toBe(
      'Minnesota provides no party information in its voter file. The ' +
        "voter file vendor models every voter's party from commercial " +
        'data, with a limited amount of partisan-contribution and ' +
        'office-holding records.',
    )
    expect(partyProvenanceForState('IL')?.sentence).toBe(
      'Illinois voters do not register by party. The voter file vendor ' +
        "assigns each voter's party from partisan primary participation " +
        'records where it has them, and models the rest.',
    )
    for (const state of ['MN', 'IL', 'CA']) {
      expect(partyProvenanceForState(state)?.sentence).not.toMatch(/\bL2\b/)
    }
    expect(partyProvenanceForState('CA')?.sentence).toBe(
      'California voters register by party, and the state voter file ' +
        'reports that choice.',
    )
    expect(partyProvenanceForState('DC')?.stateName).toBe(
      'District of Columbia',
    )
  })
})
