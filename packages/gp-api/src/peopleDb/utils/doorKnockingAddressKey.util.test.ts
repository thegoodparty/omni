import { describe, expect, it } from 'vitest'
import {
  buildDoorKnockingAddressKeySql,
  buildLegacyDoorKnockingAddressKeySql,
} from './doorKnockingAddressKey.util'

// Same trick as buildHouseholdKeySql.util.test.ts: Postgres isn't available
// here, so this applies the normalization the SQL expresses — UPPER(TRIM(
// COALESCE(col::text, ''))) joined by '|' — to voter-file fixtures and asserts
// the de-duplication property the walk list depends on.
const NORMALIZE = (value: string | null | undefined): string =>
  (value ?? '').trim().toUpperCase()

type VoterRow = {
  Residence_Addresses_AddressLine?: string | null
  Residence_Addresses_ApartmentNum?: string | null
  Residence_Addresses_Zip?: string | null
  Residence_Addresses_HouseNumber?: string | null
  Residence_Addresses_StreetName?: string | null
  Residence_Addresses_Designator?: string | null
}

const unitKeyOf = (voter: VoterRow): string =>
  [
    voter.Residence_Addresses_AddressLine,
    voter.Residence_Addresses_ApartmentNum,
    voter.Residence_Addresses_Zip,
  ]
    .map(NORMALIZE)
    .join('|')

// The legacy key, evaluated the way the mirror actually evaluates it. The two
// direction columns are INTEGER there — the loader `try_cast`s them, so a
// source value of 'S' or 'W' lands as NULL — and this fixture models that by
// never supplying them, because no row can.
const legacyKeyOf = (voter: VoterRow): string =>
  [
    voter.Residence_Addresses_HouseNumber,
    null,
    voter.Residence_Addresses_StreetName,
    voter.Residence_Addresses_Designator,
    null,
    voter.Residence_Addresses_ApartmentNum,
    voter.Residence_Addresses_Zip,
  ]
    .map(NORMALIZE)
    .join('|')

// Two doors a mile apart on a two-way street, same ZIP.
const NORTH_MAIN: VoterRow = {
  Residence_Addresses_AddressLine: '1234 N Main St',
  Residence_Addresses_HouseNumber: '1234',
  Residence_Addresses_StreetName: 'Main',
  Residence_Addresses_Designator: 'St',
  Residence_Addresses_Zip: '84101',
}
const SOUTH_MAIN: VoterRow = {
  ...NORTH_MAIN,
  Residence_Addresses_AddressLine: '1234 S Main St',
}

// Salt Lake City's grid, where the directions carry most of the address:
// these are four different corners of the city.
const GRID_CORNERS: VoterRow[] = [
  ['1234 S 5678 W'],
  ['1234 S 5678 E'],
  ['1234 N 5678 W'],
  ['1234 N 5678 E'],
].map(([line]) => ({
  Residence_Addresses_AddressLine: line,
  Residence_Addresses_HouseNumber: '1234',
  Residence_Addresses_StreetName: '5678',
  Residence_Addresses_Zip: '84116',
}))

describe('buildDoorKnockingAddressKeySql', () => {
  it('emits a CONCAT_WS of the normalized unit columns in key order', () => {
    const text = buildDoorKnockingAddressKeySql('v').strings.join('?')

    expect(text).toContain(`CONCAT_WS('|'`)
    expect(text).toContain('UPPER')
    expect(text).toContain('TRIM')
    expect(text).toContain('COALESCE')
    expect(text).toContain('v."Residence_Addresses_AddressLine"::text')
    expect(text).toContain('v."Residence_Addresses_ApartmentNum"::text')
    expect(text).toContain('v."Residence_Addresses_Zip"::text')

    const idx = (col: string) => text.indexOf(`v."Residence_Addresses_${col}"`)
    expect(idx('AddressLine')).toBeLessThan(idx('ApartmentNum'))
    expect(idx('ApartmentNum')).toBeLessThan(idx('Zip'))
  })

  // The whole point of the key change. These two columns cannot hold a cardinal
  // direction — they are INTEGER in the mirror — so a key that reads them is a
  // key that cannot tell a north address from a south one.
  it('reads neither direction column', () => {
    const text = buildDoorKnockingAddressKeySql('v').strings.join('?')

    expect(text).not.toContain('PrefixDirection')
    expect(text).not.toContain('SuffixDirection')
  })

  it('respects the requested table alias', () => {
    expect(buildDoorKnockingAddressKeySql('x').strings.join('?')).toContain(
      'x."Residence_Addresses_AddressLine"',
    )
  })

  it('still keys an apartment building one door per unit', () => {
    const units = ['1A', '1B', '2A'].map((apartment) => ({
      Residence_Addresses_AddressLine: '1200 W Elm St',
      Residence_Addresses_ApartmentNum: apartment,
      Residence_Addresses_Zip: '62704',
    }))

    expect(new Set(units.map(unitKeyOf)).size).toBe(3)
  })

  it('still collapses two residents of one unit to one door', () => {
    const residents = [
      { ...NORTH_MAIN },
      { ...NORTH_MAIN, Residence_Addresses_AddressLine: '1234 n main st ' },
    ]

    expect(new Set(residents.map(unitKeyOf)).size).toBe(1)
  })

  it('separates the two ends of a two-way street', () => {
    expect(unitKeyOf(NORTH_MAIN)).not.toBe(unitKeyOf(SOUTH_MAIN))
  })

  it('separates all four corners of a grid-addressed block', () => {
    expect(new Set(GRID_CORNERS.map(unitKeyOf)).size).toBe(4)
  })
})

// Recorded rather than accepted: this is the behaviour the current key exists
// to end, and these are the assertions that fail if anyone reintroduces a
// component-composed key.
describe('the legacy component key it replaced', () => {
  it('merged the two ends of a two-way street into one door', () => {
    expect(legacyKeyOf(NORTH_MAIN)).toBe(legacyKeyOf(SOUTH_MAIN))
  })

  it('merged all four corners of a grid-addressed block into one door', () => {
    expect(new Set(GRID_CORNERS.map(legacyKeyOf)).size).toBe(1)
  })

  it('is still buildable, so routes frozen under it can be read back', () => {
    const text = buildLegacyDoorKnockingAddressKeySql('v').strings.join('?')

    expect(text).toContain('v."Residence_Addresses_HouseNumber"::text')
    expect(text).toContain('v."Residence_Addresses_PrefixDirection"::text')
    expect(text).toContain('v."Residence_Addresses_SuffixDirection"::text')
  })
})
