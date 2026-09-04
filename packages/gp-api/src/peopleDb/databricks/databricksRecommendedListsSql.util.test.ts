import { describe, expect, it } from 'vitest'
import { filtersSchema, type FilterData } from '../schemas/filters.schema'
import {
  buildRankPrecinctsSql,
  DOOR_PRECINCT_COUNT,
} from './databricksRecommendedListsSql.util'
import type { DbxDistrict } from './databricksVoterSql.util'

const CONGRESSIONAL: DbxDistrict = {
  districtId: '635757db-0000-0000-0000-000000000000',
  state: 'CA',
  districtType: 'US_Congressional_District',
  districtName: '29',
  useVoterOnlyPath: false,
}

const noFilters = (): FilterData => filtersSchema.parse({})

describe('buildRankPrecinctsSql', () => {
  it('excludes voters with no precinct', () => {
    const { sql } = buildRankPrecinctsSql({
      district: CONGRESSIONAL,
      filters: noFilters(),
    })
    expect(sql).toMatch(/Precinct`\s+IS NOT NULL/)
    // Pins the comparison direction, not just that length(trim(...)) is
    // called: a flipped `= 0` would INCLUDE empty-precinct voters instead of
    // excluding them, and a bare `length\(trim\(/` match would stay green
    // through that flip.
    expect(sql).toMatch(/length\(trim\(\S*Precinct\S*\)\) > 0/)
  })

  it('groups by county and precinct, not precinct alone', () => {
    const { sql } = buildRankPrecinctsSql({
      district: CONGRESSIONAL,
      filters: noFilters(),
    })
    expect(sql).toMatch(/GROUP BY .*County.*Precinct/)
  })

  it('orders by voter count descending', () => {
    const { sql } = buildRankPrecinctsSql({
      district: CONGRESSIONAL,
      filters: noFilters(),
    })
    expect(sql).toMatch(/ORDER BY voters DESC/)
  })

  // The whole door-list narrowing: the top three precincts by count and
  // nothing else. Bound rather than interpolated, and asserted on the bound
  // value rather than just the presence of a LIMIT -- a LIMIT of 500 would
  // pass a `/LIMIT :p\d+/` match while handing a canvasser the district.
  it('cuts the ranking to the fixed door precinct count', () => {
    const { sql, params } = buildRankPrecinctsSql({
      district: CONGRESSIONAL,
      filters: noFilters(),
    })
    expect(sql).toMatch(/LIMIT :p\d+$/)
    expect(
      params.find(
        (p) => p.value === String(DOOR_PRECINCT_COUNT) && p.type === 'INT',
      ),
    ).toBeTruthy()
    expect(DOOR_PRECINCT_COUNT).toBe(3)
  })

  it('binds the district name rather than interpolating it', () => {
    const { sql, params } = buildRankPrecinctsSql({
      district: { ...CONGRESSIONAL, districtName: "O'Brien County" },
      filters: noFilters(),
    })
    expect(sql).not.toContain("O'Brien")
    expect(params.map((p) => p.value)).toContain("O'Brien County")
  })

  it('scopes to the district and applies the filter clause', () => {
    const { sql, params } = buildRankPrecinctsSql({
      district: CONGRESSIONAL,
      filters: filtersSchema.parse({ hasCellPhone: true }),
    })
    expect(sql).toContain('WHERE')
    expect(sql).toContain('VoterTelephones_CellPhoneFormatted')
    expect(params.map((p) => p.value)).toContain('CA')
    expect(params.map((p) => p.value)).toContain('29')
  })
})
