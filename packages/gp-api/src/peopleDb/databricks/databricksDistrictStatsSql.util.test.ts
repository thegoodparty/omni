import { parseISO } from 'date-fns'
import { describe, expect, it } from 'vitest'
import type { DbxDistrict } from './databricksVoterSql.util'
import {
  buildDistrictStatsSql,
  mapDistrictStatsRow,
  STATS_DIMENSIONS,
} from './databricksDistrictStatsSql.util'

const DISTRICT: DbxDistrict = {
  districtId: '635757db-0000-0000-0000-000000000000',
  state: 'CA',
  districtType: 'US_Congressional_District',
  districtName: '29',
  useVoterOnlyPath: false,
}

const COMPUTED_AT = new Date('2026-08-20T12:00:00.000Z')

const LABELS = STATS_DIMENSIONS.flatMap(({ key, buckets }) =>
  buckets.map(({ label }) => `${key}:${label}`),
)

// [total, withCell, ...one count per bucket in STATS_DIMENSIONS order]
const buildRow = (
  total: number,
  withCell: number,
  counts: Record<string, number>,
): Array<string | null> => [
  String(total),
  String(withCell),
  ...LABELS.map((label) => String(counts[label] ?? 0)),
]

describe('buildDistrictStatsSql', () => {
  it('scopes on the voter row L2 district column', () => {
    const { sql, params } = buildDistrictStatsSql(DISTRICT)

    expect(sql).toContain(
      'WHERE v.`State` = :p0 AND v.`US_Congressional_District` = :p1',
    )
    expect(params).toEqual([
      { name: 'p0', value: 'CA', type: 'STRING' },
      { name: 'p1', value: '29', type: 'STRING' },
    ])
    expect(sql.toLowerCase()).not.toContain('districtstats')
  })

  it('drops the district predicate on the voter-only path', () => {
    const { sql, params } = buildDistrictStatsSql({
      ...DISTRICT,
      districtType: 'State',
      districtName: 'CA',
      useVoterOnlyPath: true,
    })

    expect(sql).toContain('WHERE v.`State` = :p0')
    expect(params).toEqual([{ name: 'p0', value: 'CA', type: 'STRING' }])
    expect(sql).not.toContain('US_Congressional_District')
  })

  it('counts the two totals plus one count_if per bucket', () => {
    const { sql } = buildDistrictStatsSql(DISTRICT)

    expect(sql).toContain('COUNT(*) AS total')
    expect(sql).toContain(
      'COUNT(v.`VoterTelephones_CellPhoneFormatted`) AS with_cell',
    )
    expect(sql.match(/count_if\(/g)).toHaveLength(LABELS.length)
  })

  it('cuts age at 25, 35 and 50 with a null Unknown bucket', () => {
    const { sql } = buildDistrictStatsSql(DISTRICT)

    expect(sql).toContain('count_if(v.`Age_Int` IS NULL) AS age_0')
    expect(sql).toContain('count_if(v.`Age_Int` <= 25) AS age_1')
    expect(sql).toContain(
      'count_if(v.`Age_Int` > 25 AND v.`Age_Int` <= 35) AS age_2',
    )
    expect(sql).toContain(
      'count_if(v.`Age_Int` > 35 AND v.`Age_Int` <= 50) AS age_3',
    )
    expect(sql).toContain('count_if(v.`Age_Int` > 50) AS age_4')
  })

  it('uses half-open income bands from below-15k up to 250k+', () => {
    const { sql } = buildDistrictStatsSql(DISTRICT)
    const income = 'v.`Estimated_Income_Amount_Int`'

    expect(sql).toContain(`count_if(${income} < 15000)`)
    expect(sql).toContain(`count_if(${income} >= 15000 AND ${income} < 25000)`)
    expect(sql).toContain(
      `count_if(${income} >= 200000 AND ${income} < 250000)`,
    )
    expect(sql).toContain(`count_if(${income} >= 250000)`)
  })

  it('folds Probable Home Owner into Yes, with no Likely bucket', () => {
    const { sql } = buildDistrictStatsSql(DISTRICT)
    const labels = STATS_DIMENSIONS.find(
      ({ key }) => key === 'homeowner',
    )?.buckets.map(({ label }) => label)

    expect(labels).toEqual(['Yes', 'No', 'Unknown'])
    expect(sql).toContain(
      "count_if(v.`Homeowner_Probability_Model` IN ('Home Owner', " +
        "'Probable Home Owner')) AS homeowner_0",
    )
  })

  it('maps presence of children from the Y/N column', () => {
    const { sql } = buildDistrictStatsSql(DISTRICT)

    expect(sql).toContain(
      "count_if(v.`Presence_Of_Children` = 'Y') AS presenceOfChildren_0",
    )
    expect(sql).toContain(
      "count_if(v.`Presence_Of_Children` = 'N') AS presenceOfChildren_1",
    )
  })

  it('treats an unrecognized education value as Unknown', () => {
    const { sql } = buildDistrictStatsSql(DISTRICT)

    expect(sql).toContain(
      'count_if(v.`Education_Of_Person` IS NULL OR ' +
        'v.`Education_Of_Person` NOT IN (',
    )
  })
})

describe('mapDistrictStatsRow', () => {
  it('returns null for a district with no voters, never a zero row', () => {
    const row = buildRow(0, 0, {})

    expect(mapDistrictStatsRow('d1', row, COMPUTED_AT)).toBeNull()
  })

  it('returns null when the query produced no row at all', () => {
    expect(mapDistrictStatsRow('d1', undefined, COMPUTED_AT)).toBeNull()
  })

  it('carries both totals through', () => {
    const stats = mapDistrictStatsRow(
      'd1',
      buildRow(100, 42, { 'age:51+': 100 }),
      COMPUTED_AT,
    )

    expect(stats?.districtId).toBe('d1')
    expect(stats?.totalConstituents).toBe(100)
    expect(stats?.totalConstituentsWithCellPhone).toBe(42)
    expect(parseISO(stats?.computedAt ?? '').getTime()).toBe(
      COMPUTED_AT.getTime(),
    )
  })

  it('omits zero-count labels entirely', () => {
    const stats = mapDistrictStatsRow(
      'd1',
      buildRow(10, 0, { 'age:18-25': 10 }),
      COMPUTED_AT,
    )

    expect(stats?.buckets.age).toEqual([
      { label: '18-25', count: 10, percent: 100 },
    ])
  })

  it('sorts labels descending by label string', () => {
    const stats = mapDistrictStatsRow(
      'd1',
      buildRow(4, 0, {
        'age:18-25': 1,
        'age:26-35': 1,
        'age:51+': 1,
        'age:Unknown': 1,
      }),
      COMPUTED_AT,
    )

    expect(stats?.buckets.age.map((b) => b.label)).toEqual([
      'Unknown',
      '51+',
      '26-35',
      '18-25',
    ])
  })

  it('rounds percent to two decimals', () => {
    const stats = mapDistrictStatsRow(
      'd1',
      buildRow(3, 0, { 'age:18-25': 1, 'age:26-35': 2 }),
      COMPUTED_AT,
    )
    const percents = stats?.buckets.age.map((b) => b.percent)

    expect(percents).toEqual([66.67, 33.33])
  })

  it('keeps every bucket summing to the total', () => {
    const stats = mapDistrictStatsRow(
      'd1',
      buildRow(9, 3, {
        'age:18-25': 4,
        'age:51+': 5,
        'homeowner:Yes': 2,
        'homeowner:Unknown': 7,
        'education:Unknown': 9,
        'presenceOfChildren:No': 9,
        'estimatedIncomeRange:Unknown': 9,
      }),
      COMPUTED_AT,
    )

    for (const { key } of STATS_DIMENSIONS) {
      const sum = stats?.buckets[key].reduce(
        (total, bucket) => total + bucket.count,
        0,
      )
      expect(sum).toBe(9)
    }
  })

  it('uses the EN DASH income labels the product renders today', () => {
    const stats = mapDistrictStatsRow(
      'd1',
      buildRow(2, 0, {
        'estimatedIncomeRange:1k–15k': 1,
        'estimatedIncomeRange:250k+': 1,
      }),
      COMPUTED_AT,
    )

    expect(stats?.buckets.estimatedIncomeRange.map((b) => b.label)).toEqual([
      '250k+',
      '1k–15k',
    ])
  })
})
