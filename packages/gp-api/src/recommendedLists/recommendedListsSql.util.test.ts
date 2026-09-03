import { describe, expect, it } from 'vitest'
import {
  filtersSchema,
  type FilterData,
} from '../peopleDb/schemas/filters.schema'
import type { DbxDistrict } from '@/peopleDb/databricks/databricksVoterSql.util'
import {
  buildRankPrecinctsSql,
  MAX_RANKED_PRECINCTS,
} from './recommendedListsSql.util'

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
      limit: MAX_RANKED_PRECINCTS,
    })
    expect(sql).toMatch(/Precinct`\s+IS NOT NULL/)
    expect(sql).toMatch(/length\(trim\(/)
  })

  it('groups by county and precinct, not precinct alone', () => {
    const { sql } = buildRankPrecinctsSql({
      district: CONGRESSIONAL,
      filters: noFilters(),
      limit: MAX_RANKED_PRECINCTS,
    })
    expect(sql).toMatch(/GROUP BY .*County.*Precinct/)
  })

  it('orders by voter count descending', () => {
    const { sql } = buildRankPrecinctsSql({
      district: CONGRESSIONAL,
      filters: noFilters(),
      limit: MAX_RANKED_PRECINCTS,
    })
    expect(sql).toMatch(/ORDER BY voters DESC/)
  })

  it('bounds the row count with the given limit', () => {
    const { sql, params } = buildRankPrecinctsSql({
      district: CONGRESSIONAL,
      filters: noFilters(),
      limit: 42,
    })
    expect(sql).toMatch(/LIMIT :p\d+$/)
    expect(
      params.find((p) => p.value === '42' && p.type === 'INT'),
    ).toBeTruthy()
  })

  it('binds the district name rather than interpolating it', () => {
    const { sql, params } = buildRankPrecinctsSql({
      district: { ...CONGRESSIONAL, districtName: "O'Brien County" },
      filters: noFilters(),
      limit: MAX_RANKED_PRECINCTS,
    })
    expect(sql).not.toContain("O'Brien")
    expect(params.map((p) => p.value)).toContain("O'Brien County")
  })

  it('scopes to the district and applies the filter clause', () => {
    const { sql, params } = buildRankPrecinctsSql({
      district: CONGRESSIONAL,
      filters: filtersSchema.parse({ hasCellPhone: true }),
      limit: MAX_RANKED_PRECINCTS,
    })
    expect(sql).toContain('WHERE')
    expect(sql).toContain('VoterTelephones_CellPhoneFormatted')
    expect(params.map((p) => p.value)).toContain('CA')
    expect(params.map((p) => p.value)).toContain('29')
  })
})
