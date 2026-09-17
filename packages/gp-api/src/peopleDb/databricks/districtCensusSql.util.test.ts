import { describe, expect, it } from 'vitest'
import { buildDistrictCensusSql, CENSUS_TABLE } from './districtCensusSql.util'
import type { DbxDistrict } from './databricksVoterSql.util'

const DISTRICT: DbxDistrict = {
  districtId: 'd-1',
  state: 'WA',
  districtType: 'Water_District',
  districtName: 'EAST WENATCHEE WATER',
  useVoterOnlyPath: false,
}

describe('buildDistrictCensusSql', () => {
  it('selects district_population from the census mart table', () => {
    const { sql } = buildDistrictCensusSql(DISTRICT)

    expect(sql).toContain(`SELECT district_population FROM ${CENSUS_TABLE}`)
    expect(CENSUS_TABLE).toBe(
      'goodparty_data_catalog.mart_gp_api.gp_api_district_census_stats',
    )
  })

  // All three grain values are bound parameters, never spliced into the
  // statement -- unlike buildScopeSql's district column, district_type here
  // is a value in the row, not an identifier, so nothing needs the
  // SAFE_IDENTIFIER guard.
  it('binds all three grain values as parameters, not interpolated', () => {
    const { sql, params } = buildDistrictCensusSql(DISTRICT)

    expect(sql).toBe(
      `SELECT district_population FROM ${CENSUS_TABLE}` +
        ' WHERE state_postal_code = :p0' +
        ' AND district_type = :p1' +
        ' AND district_name = :p2',
    )
    expect(params).toEqual([
      { name: 'p0', value: 'WA', type: 'STRING' },
      { name: 'p1', value: 'Water_District', type: 'STRING' },
      { name: 'p2', value: 'EAST WENATCHEE WATER', type: 'STRING' },
    ])
    expect(sql).not.toContain('WA')
    expect(sql).not.toContain('Water_District')
    expect(sql).not.toContain('EAST WENATCHEE WATER')
  })
})
