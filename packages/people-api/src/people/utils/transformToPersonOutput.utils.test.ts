import { describe, expect, it } from 'vitest'
import {
  mapPoliticalParty,
  mapVoterStatus,
} from './transformToPersonOutput.utils'
import {
  classifyPoliticalParty,
  POLITICAL_PARTY_RULES,
  RULED_POLITICAL_PARTIES,
} from './politicalParty.rules'

// Verbatim copy of the ORIGINAL inline mapPoliticalParty if-chain (pre-shared-
// table refactor). The refactored classifier must stay byte-for-byte identical
// to this oracle for every input, so display output cannot drift.
const legacyMapPoliticalParty = (
  value: string | null | undefined,
): string | undefined => {
  if (!value) return 'Other'
  const v = value.toLowerCase()
  if (v.includes('democratic') || v.includes('democrat')) return 'Democratic'
  if (v.includes('republican')) return 'Republican'
  if (
    v.includes('independent') ||
    v.includes('declined to state') ||
    v.includes('non-partisan')
  )
    return 'Independent'
  return 'Other'
}

// Real Parties_Description values (knownValues.utils.ts) plus the substring /
// precedence edge cases called out in the reconciliation work, plus null/blank.
const PARTY_SAMPLE_VALUES: Array<string | null | undefined> = [
  null,
  undefined,
  '',
  '   ', // whitespace-only is truthy -> falls through to 'Other'
  'Democratic',
  'Republican',
  'Non-Partisan',
  'Declined to State',
  'American Independent',
  'Registered Independent',
  'Harold Washington Democrat',
  'Harold Washington Republican',
  'Social Democrat',
  'Citizens Republican',
  'Independent Democrat',
  'Independent Republican',
  'Independence',
  'Green',
  'Libertarian',
  'Working Family Party',
  'Unknown',
  // Explicit precedence probes (value carrying two competing tokens).
  'Independent Democratic Coalition',
  'REPUBLICAN democrat', // uppercase to prove case-insensitivity + precedence
  'independent republican party',
]

describe('mapPoliticalParty', () => {
  it('is byte-for-byte identical to the legacy classifier for every sample', () => {
    for (const value of PARTY_SAMPLE_VALUES) {
      expect(mapPoliticalParty(value)).toBe(legacyMapPoliticalParty(value))
    }
  })

  it('delegates to the shared classifyPoliticalParty', () => {
    for (const value of PARTY_SAMPLE_VALUES) {
      expect(mapPoliticalParty(value)).toBe(classifyPoliticalParty(value))
    }
  })

  it('classifies via case-insensitive substring with fixed precedence', () => {
    expect(mapPoliticalParty('Harold Washington Democrat')).toBe('Democratic')
    expect(mapPoliticalParty('Citizens Republican')).toBe('Republican')
    expect(mapPoliticalParty('American Independent')).toBe('Independent')
    expect(mapPoliticalParty('Declined to State')).toBe('Independent')
    expect(mapPoliticalParty('Social Democrat')).toBe('Democratic')
    // Democrat precedes both Republican and Independent.
    expect(mapPoliticalParty('Independent Democrat')).toBe('Democratic')
    expect(mapPoliticalParty('REPUBLICAN democrat')).toBe('Democratic')
    // Republican precedes Independent.
    expect(mapPoliticalParty('Independent Republican')).toBe('Republican')
  })

  it('maps null, undefined and empty string to Other', () => {
    expect(mapPoliticalParty(null)).toBe('Other')
    expect(mapPoliticalParty(undefined)).toBe('Other')
    expect(mapPoliticalParty('')).toBe('Other')
  })

  it('maps unrecognized non-empty values to Other', () => {
    expect(mapPoliticalParty('Green')).toBe('Other')
    expect(mapPoliticalParty('Libertarian')).toBe('Other')
    expect(mapPoliticalParty('Independence')).toBe('Other') // no 'independent' token
  })
})

describe('politicalParty.rules table', () => {
  it('encodes the historical precedence order exactly', () => {
    expect(RULED_POLITICAL_PARTIES).toEqual([
      'Democratic',
      'Republican',
      'Independent',
    ])
  })

  it('encodes the historical substring tokens exactly', () => {
    expect(POLITICAL_PARTY_RULES).toEqual([
      { party: 'Democratic', substrings: ['democratic', 'democrat'] },
      { party: 'Republican', substrings: ['republican'] },
      {
        party: 'Independent',
        substrings: ['independent', 'declined to state', 'non-partisan'],
      },
    ])
  })
})

describe('mapVoterStatus', () => {
  it('passes through every known voterStatus value', () => {
    for (const value of [
      'Super',
      'Likely',
      'Unreliable',
      'Unlikely',
      'First Time',
    ]) {
      expect(mapVoterStatus(value)).toBe(value)
    }
  })

  it('maps the Unknown sentinel to null', () => {
    expect(mapVoterStatus('Unknown')).toBeNull()
  })

  it('maps null / undefined / blank to null', () => {
    expect(mapVoterStatus(null)).toBeNull()
    expect(mapVoterStatus(undefined)).toBeNull()
    expect(mapVoterStatus('')).toBeNull()
  })

  it('maps an unrecognized value to null instead of an unchecked cast', () => {
    expect(mapVoterStatus('Occasional')).toBeNull()
    expect(mapVoterStatus('super')).toBeNull() // case-sensitive enum
    expect(mapVoterStatus('garbage')).toBeNull()
  })
})
