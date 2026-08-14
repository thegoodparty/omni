import { describe, expect, it } from 'vitest'
import { parseProposedCongressionalNumber } from './proposedDistrictName.util'

describe('parseProposedCongressionalNumber', () => {
  it('parses a zero-padded congressional district number', () => {
    expect(
      parseProposedCongressionalNumber('2026 PROPOSED CONG DIST 04 (EST.)'),
    ).toBe(4)
  })

  it('parses a two-digit district number', () => {
    expect(
      parseProposedCongressionalNumber('2026 PROPOSED CONG DIST 15 (EST.)'),
    ).toBe(15)
  })

  it('rejects a proposed state senate district', () => {
    expect(
      parseProposedCongressionalNumber('2026 PROPOSED STATE SEN DIST 01'),
    ).toBeNull()
  })

  it('rejects an annexation area', () => {
    expect(
      parseProposedCongressionalNumber('PROPOSED ANNEXATION AREA 3'),
    ).toBeNull()
  })

  it('requires the leading year', () => {
    expect(
      parseProposedCongressionalNumber('PROPOSED CONG DIST 04 (EST.)'),
    ).toBeNull()
  })

  it('is case insensitive and tolerates surrounding whitespace', () => {
    expect(
      parseProposedCongressionalNumber('  2026 proposed cong dist 07 (est.) '),
    ).toBe(7)
  })

  it('returns null for an empty string', () => {
    expect(parseProposedCongressionalNumber('')).toBeNull()
  })
})
