import { describe, expect, it } from 'vitest'
import {
  mapLanguage,
  mapPoliticalParty,
  mapVoterStatus,
} from './transformToPersonOutput.util'
import {
  classifyPoliticalParty,
  POLITICAL_PARTY_EXACT_VALUES,
  RULED_POLITICAL_PARTIES,
} from './politicalParty.rules'

// Real Parties_Description values plus edge cases: exact matches, the minor-
// party / substring tail that now classifies as Other, and null/blank.
const PARTY_SAMPLE_VALUES: Array<string | null | undefined> = [
  null,
  undefined,
  '',
  '   ',
  'Democratic',
  'Republican',
  'Non-Partisan',
  'Declined to State',
  'American Independent',
  'Registered Independent',
  'Harold Washington Democrat',
  'Citizens Republican',
  'Independent Democrat',
  'Independence',
  'Green',
  'Libertarian',
  'Working Family Party',
  'democratic', // lowercase — exact match is case-sensitive
]

describe('mapPoliticalParty', () => {
  it('delegates to the shared classifyPoliticalParty', () => {
    for (const value of PARTY_SAMPLE_VALUES) {
      expect(mapPoliticalParty(value)).toBe(classifyPoliticalParty(value))
    }
  })

  it('classifies the exact major-party values', () => {
    expect(mapPoliticalParty('Democratic')).toBe('Democratic')
    expect(mapPoliticalParty('Republican')).toBe('Republican')
    expect(mapPoliticalParty('Non-Partisan')).toBe('Independent')
    expect(mapPoliticalParty('American Independent')).toBe('Independent')
    expect(mapPoliticalParty('Registered Independent')).toBe('Independent')
    expect(mapPoliticalParty('Declined to State')).toBe('Independent')
  })

  it('is case- and spelling-exact (so the SQL filter can use the btree)', () => {
    expect(mapPoliticalParty('democratic')).toBe('Other')
    expect(mapPoliticalParty('DEMOCRATIC')).toBe('Other')
    expect(mapPoliticalParty('Non Partisan')).toBe('Other')
  })

  it('maps null, undefined and empty string to Other', () => {
    expect(mapPoliticalParty(null)).toBe('Other')
    expect(mapPoliticalParty(undefined)).toBe('Other')
    expect(mapPoliticalParty('')).toBe('Other')
  })

  it('maps minor parties and substring near-matches to Other', () => {
    expect(mapPoliticalParty('Green')).toBe('Other')
    expect(mapPoliticalParty('Libertarian')).toBe('Other')
    expect(mapPoliticalParty('Independence')).toBe('Other')
    // No longer substring-matched into a major party.
    expect(mapPoliticalParty('Harold Washington Democrat')).toBe('Other')
    expect(mapPoliticalParty('Citizens Republican')).toBe('Other')
    expect(mapPoliticalParty('Independent Democrat')).toBe('Other')
  })
})

describe('politicalParty.rules table', () => {
  it('lists the ruled parties in a stable order', () => {
    expect(RULED_POLITICAL_PARTIES).toEqual([
      'Democratic',
      'Republican',
      'Independent',
    ])
  })

  it('encodes the exact-match value sets', () => {
    expect(POLITICAL_PARTY_EXACT_VALUES).toEqual({
      Democratic: ['Democratic'],
      Republican: ['Republican'],
      Independent: [
        'Non-Partisan',
        'American Independent',
        'Registered Independent',
        'Declined to State',
      ],
    })
  })
})

describe('mapLanguage', () => {
  it('maps the two named languages, case-insensitively', () => {
    expect(mapLanguage('English')).toBe('English')
    expect(mapLanguage('spanish')).toBe('Spanish')
  })

  it('maps a language we have but do not name to Other', () => {
    expect(mapLanguage('Vietnamese')).toBe('Other')
  })

  // The display half of the split: 'Other' is a claim about what someone
  // speaks, and an empty column does not make it. This returned 'Other', so a
  // person the filter calls Unknown read as an Other-language speaker.
  it('maps null / undefined / blank to null rather than Other', () => {
    expect(mapLanguage(null)).toBeNull()
    expect(mapLanguage(undefined)).toBeNull()
    expect(mapLanguage('')).toBeNull()
  })
})

describe('mapVoterStatus', () => {
  it('passes through every known voterStatus value', () => {
    for (const value of ['Super', 'Likely', 'Unreliable', 'Unlikely']) {
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
