import { describe, expect, it } from 'vitest'
import {
  buildDistrictStatsSql,
  mapDistrictStatsRow,
  STATS_DIMENSION_KEYS,
} from './databricksDistrictStatsSql.util'

const DISTRICT_ID = '635757db-0000-0000-0000-000000000000'

const bucketJson = (label: string, count: number, percent: number) =>
  JSON.stringify([{ label, count: String(count), percent: String(percent) }])

// [total, withCell, updatedAt, ...one JSON array per dimension, in key order]
const row = (total: string): Array<string | null> => [
  total,
  '40',
  '2026-08-22T00:33:05.582Z',
  bucketJson('18-25', 100, 100),
  bucketJson('College Degree', 90, 90),
  bucketJson('Yes', 80, 80),
  bucketJson('No', 70, 70),
  bucketJson('250k+', 60, 60),
]

describe('buildDistrictStatsSql', () => {
  it('looks the district up by key instead of scanning voters', () => {
    const { sql, params } = buildDistrictStatsSql(DISTRICT_ID)

    expect(sql).toContain('gp_api_district_stats')
    expect(sql).toContain('WHERE district_id = :p0')
    // The whole point of the mirrored table: no aggregate over voter rows.
    expect(sql).not.toContain('count_if')
    expect(sql).not.toContain('gp_api_voters')
    expect(params).toEqual([{ name: 'p0', value: DISTRICT_ID, type: 'STRING' }])
  })

  it('asks for every dimension the product renders', () => {
    const { sql } = buildDistrictStatsSql(DISTRICT_ID)

    for (const key of STATS_DIMENSION_KEYS) {
      expect(sql).toContain(`to_json(buckets.${key}) AS ${key}`)
    }
  })
})

describe('mapDistrictStatsRow', () => {
  // Absence is the product signal: a district with no row must stay null so the
  // webapp shows "no constituent data" rather than a zero-filled page.
  it('returns null when the district has no stats row', () => {
    expect(mapDistrictStatsRow(DISTRICT_ID, undefined)).toBeNull()
  })

  it('maps totals, timestamp, and every bucket dimension', () => {
    const stats = mapDistrictStatsRow(DISTRICT_ID, row('100'))

    expect(stats?.districtId).toBe(DISTRICT_ID)
    expect(stats?.totalConstituents).toBe(100)
    expect(stats?.totalConstituentsWithCellPhone).toBe(40)
    expect(stats?.updatedAt.toISOString()).toBe('2026-08-22T00:33:05.582Z')
    expect(stats?.buckets.age).toEqual([
      { label: '18-25', count: 100, percent: 100 },
    ])
    expect(stats?.buckets.education).toEqual([
      { label: 'College Degree', count: 90, percent: 90 },
    ])
    expect(stats?.buckets.homeowner).toEqual([
      { label: 'Yes', count: 80, percent: 80 },
    ])
    expect(stats?.buckets.presenceOfChildren).toEqual([
      { label: 'No', count: 70, percent: 70 },
    ])
    expect(stats?.buckets.estimatedIncomeRange).toEqual([
      { label: '250k+', count: 60, percent: 60 },
    ])
  })

  it('tolerates a dimension the table left empty', () => {
    const sparse = row('100')
    sparse[3] = null
    sparse[4] = '[]'

    const stats = mapDistrictStatsRow(DISTRICT_ID, sparse)

    expect(stats?.buckets.age).toEqual([])
    expect(stats?.buckets.education).toEqual([])
    expect(stats?.buckets.homeowner).not.toEqual([])
  })
})
