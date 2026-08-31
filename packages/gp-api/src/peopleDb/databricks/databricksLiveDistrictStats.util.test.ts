import { describe, expect, it } from 'vitest'
import {
  buildLiveDistrictStatsSql,
  mapLiveDistrictStatsRows,
} from './databricksDistrictStatsSql.util'
import { VALUE_MAPPERS } from '../utils/valueMappers.util'

const DISTRICT = {
  districtId: 'd-1',
  state: 'WA',
  districtType: 'Water_District',
  districtName: 'EAST WENATCHEE WATER',
  useVoterOnlyPath: false,
}

const sqlFor = (district = DISTRICT) => buildLiveDistrictStatsSql(district).sql

describe('buildLiveDistrictStatsSql', () => {
  it('is one statement over one scan', () => {
    const sql = sqlFor()

    expect(sql).toContain('GROUPING SETS')
    expect(sql.match(/FROM goodparty_data_catalog/g)).toHaveLength(1)
    expect(sql).not.toContain(';')
  })

  it('emits a grouping set per dimension plus the grand total', () => {
    expect(sqlFor()).toContain(
      'GROUPING SETS ((age), (education), (homeowner), ' +
        '(presenceOfChildren), (estimatedIncomeRange), ())',
    )
  })

  it('scopes on state and the district type column, bound as parameters', () => {
    const { sql, params } = buildLiveDistrictStatsSql(DISTRICT)

    expect(sql).toContain('v.`State` = :p0')
    expect(sql).toContain('v.`Water_District` = :p1')
    expect(params.map((p) => p.value)).toEqual(['WA', 'EAST WENATCHEE WATER'])
  })

  it('drops the district predicate for a state district', () => {
    const sql = sqlFor({
      ...DISTRICT,
      districtType: 'State',
      districtName: 'WA',
      useVoterOnlyPath: true,
    })

    expect(sql).toContain('v.`State` = :p0')
    expect(sql).not.toContain('v.`State` = :p1')
  })

  // The stats labels are derived from VALUE_MAPPERS rather than restated, so a
  // change to the filter vocabulary cannot silently relabel a stats bucket.
  // This asserts the direction of that derivation for every mapped dimension.
  it.each([
    ['educationLevel', 'College Degree'],
    ['educationLevel', 'High School Diploma'],
    ['educationLevel', 'Some College'],
    ['educationLevel', 'Graduate Degree'],
    ['educationLevel', 'Technical School'],
    ['educationLevel', 'None'],
    ['presenceOfChildren', 'Yes'],
    ['presenceOfChildren', 'No'],
    ['homeowner', 'No'],
  ] as const)('maps %s label %s from VALUE_MAPPERS', (mapper, label) => {
    const raw = VALUE_MAPPERS[mapper](label)
    const values = Array.isArray(raw) ? raw : [raw]
    for (const value of values) {
      expect(sqlFor()).toContain(`WHEN '${value}' THEN '${label}'`)
    }
  })

  it("folds both homeowner raw values into 'Yes'", () => {
    const sql = sqlFor()

    expect(sql).toContain("WHEN 'Home Owner' THEN 'Yes'")
    expect(sql).toContain("WHEN 'Probable Home Owner' THEN 'Yes'")
  })

  // The stats table publishes income labels with an en dash. A hyphen here
  // would read as a disagreement on every district the dual read compares.
  it('labels income bands with an en dash', () => {
    const sql = sqlFor()

    expect(sql).toContain("THEN '75k–100k'")
    expect(sql).toContain("THEN '100k–125k'")
    expect(sql).not.toContain("THEN '75k-100k'")
  })

  it('covers the income band the mirrored table publishes', () => {
    const sql = sqlFor()

    for (const ceiling of [
      15000, 25000, 35000, 50000, 75000, 100000, 125000, 150000, 175000, 200000,
      250000,
    ]) {
      expect(sql).toContain(`< ${ceiling} THEN`)
    }
    expect(sql).toContain("ELSE '250k+'")
  })
})

describe('mapLiveDistrictStatsRows', () => {
  const rows = [
    ['TOTAL', 'all', '200', '80'],
    ['age', '51+', '150', null],
    ['age', '18-25', '50', null],
    ['education', 'Unknown', '200', null],
  ]

  it('reads both totals from the grand-total row', () => {
    const stats = mapLiveDistrictStatsRows('d-1', rows)

    expect(stats?.totalConstituents).toBe(200)
    expect(stats?.totalConstituentsWithCellPhone).toBe(80)
  })

  it('derives percent from the total', () => {
    const stats = mapLiveDistrictStatsRows('d-1', rows)

    expect(stats?.buckets.age).toEqual([
      { label: '51+', count: 150, percent: 75 },
      { label: '18-25', count: 50, percent: 25 },
    ])
  })

  it('rounds percent to two decimals', () => {
    const stats = mapLiveDistrictStatsRows('d-1', [
      ['TOTAL', 'all', '22547', '11483'],
      ['age', 'Unknown', '3', null],
    ])

    expect(stats?.buckets.age[0]?.percent).toBe(0.01)
  })

  it('orders buckets by descending count', () => {
    const stats = mapLiveDistrictStatsRows('d-1', [
      ['TOTAL', 'all', '10', '0'],
      ['age', '18-25', '2', null],
      ['age', '51+', '8', null],
    ])

    expect(stats?.buckets.age.map((b) => b.label)).toEqual(['51+', '18-25'])
  })

  // Absence is load-bearing: a district with no constituents has to read as
  // "no stats", the same as a missing mirrored row, because the product gates
  // on that rather than rendering zeros.
  it('returns null when the scan finds no voters', () => {
    expect(
      mapLiveDistrictStatsRows('d-1', [['TOTAL', 'all', '0', '0']]),
    ).toBeNull()
  })

  it('returns null for an empty result', () => {
    expect(mapLiveDistrictStatsRows('d-1', [])).toBeNull()
  })

  it('ignores a dimension it does not publish', () => {
    const stats = mapLiveDistrictStatsRows('d-1', [
      ...rows,
      ['somethingElse', 'x', '1', null],
    ])

    expect(Object.keys(stats?.buckets ?? {})).toEqual([
      'age',
      'education',
      'homeowner',
      'presenceOfChildren',
      'estimatedIncomeRange',
    ])
  })
})
