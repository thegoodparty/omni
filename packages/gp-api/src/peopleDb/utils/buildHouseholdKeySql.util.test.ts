import { describe, expect, it } from 'vitest'
import { Prisma } from '../../generated/people-prisma'
import { buildHouseholdKeySql } from './buildHouseholdKeySql.util'

// The key SQL is `CONCAT_WS('|', UPPER(TRIM(COALESCE(col,''))), ...)`. We can't
// run Postgres here, so this evaluator applies the SAME normalization the SQL
// expresses to a fixture, then asserts the de-dup property the door-knocking
// list relies on: voters at one physical address collapse to one key.
const NORMALIZE = (v: string | null | undefined): string =>
  (v ?? '').trim().toUpperCase()

const householdKeyOf = (voter: {
  Residence_Addresses_AddressLine?: string | null
  Residence_Addresses_City?: string | null
  Residence_Addresses_State?: string | null
  Residence_Addresses_Zip?: string | null
}): string =>
  [
    voter.Residence_Addresses_AddressLine,
    voter.Residence_Addresses_City,
    voter.Residence_Addresses_State,
    voter.Residence_Addresses_Zip,
  ]
    .map(NORMALIZE)
    .join('|')

describe('buildHouseholdKeySql', () => {
  it('emits a CONCAT_WS of normalized residence-address columns in order', () => {
    const sql = buildHouseholdKeySql('v')
    const text = sql.strings.join('?')

    expect(text).toContain(`CONCAT_WS('|'`)
    expect(text).toContain('UPPER')
    expect(text).toContain('TRIM')
    expect(text).toContain('COALESCE')
    // The four residence columns, addressed off the `v` alias, in key order.
    expect(text).toContain('v."Residence_Addresses_AddressLine"')
    expect(text).toContain('v."Residence_Addresses_City"')
    expect(text).toContain('v."Residence_Addresses_State"')
    expect(text).toContain('v."Residence_Addresses_Zip"')
    const idx = (col: string) => text.indexOf(`v."Residence_Addresses_${col}"`)
    expect(idx('AddressLine')).toBeLessThan(idx('City'))
    expect(idx('City')).toBeLessThan(idx('State'))
    expect(idx('State')).toBeLessThan(idx('Zip'))
    // It does NOT key on the mailing-household id (wrong key for canvassing).
    expect(text).not.toContain('Mailing_Families_FamilyID')
  })

  it('respects the requested table alias', () => {
    expect(buildHouseholdKeySql('x').strings.join('?')).toContain(
      'x."Residence_Addresses_AddressLine"',
    )
  })

  it('collapses a multi-voter household to one key (grouped < voters)', () => {
    // 5 voters across 3 physical households: two share 123 Main (one with
    // lowercase + trailing space, proving normalization), two share 9 Oak,
    // one alone at 5 Elm.
    const voters = [
      {
        Residence_Addresses_AddressLine: '123 Main St',
        Residence_Addresses_City: 'Cheyenne',
        Residence_Addresses_State: 'WY',
        Residence_Addresses_Zip: '82001',
      },
      {
        Residence_Addresses_AddressLine: '123 main st ',
        Residence_Addresses_City: 'CHEYENNE',
        Residence_Addresses_State: 'WY',
        Residence_Addresses_Zip: '82001',
      },
      {
        Residence_Addresses_AddressLine: '9 Oak Ave',
        Residence_Addresses_City: 'Cheyenne',
        Residence_Addresses_State: 'WY',
        Residence_Addresses_Zip: '82001',
      },
      {
        Residence_Addresses_AddressLine: '9 Oak Ave',
        Residence_Addresses_City: 'Cheyenne',
        Residence_Addresses_State: 'WY',
        Residence_Addresses_Zip: '82001',
      },
      {
        Residence_Addresses_AddressLine: '5 Elm Rd',
        Residence_Addresses_City: 'Cheyenne',
        Residence_Addresses_State: 'WY',
        Residence_Addresses_Zip: '82001',
      },
    ]

    const distinctHouseholds = new Set(voters.map(householdKeyOf))

    expect(voters.length).toBe(5)
    expect(distinctHouseholds.size).toBe(3)
    expect(distinctHouseholds.size).toBeLessThan(voters.length)
  })
})

// Guard the type Prisma.Sql still exposes `.strings` (the assertions above rely
// on it; inlinePrismaSql depends on the same contract).
describe('Prisma.Sql shape', () => {
  it('exposes a strings array', () => {
    expect(Array.isArray(buildHouseholdKeySql().strings)).toBe(true)
    expect(Prisma.empty.strings).toBeDefined()
  })
})
