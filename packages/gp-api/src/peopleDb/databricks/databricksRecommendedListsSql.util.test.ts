import { describe, expect, it } from 'vitest'
import { filtersSchema, type FilterData } from '../schemas/filters.schema'
import {
  buildRankPrecinctsSql,
  buildRecommendedListCountsSql,
  DOOR_PRECINCT_COUNT,
  type RecommendedListCountScope,
} from './databricksRecommendedListsSql.util'
import { buildCountSql, type DbxDistrict } from './databricksVoterSql.util'
import { DEFAULT_AFFINITY_COLUMN } from '../affinityColumns.const'

const VOTERS_TABLE = 'goodparty_data_catalog.mart_gp_api.gp_api_voters'

const CONGRESSIONAL: DbxDistrict = {
  districtId: '635757db-0000-0000-0000-000000000000',
  state: 'CA',
  districtType: 'US_Congressional_District',
  districtName: '29',
  useVoterOnlyPath: false,
  dataset: { base: 'voters' },
  table: VOTERS_TABLE,
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

describe('buildRecommendedListCountsSql', () => {
  const variant = (
    filters: Record<string, unknown>,
  ): RecommendedListCountScope => ({
    filters: filtersSchema.parse(filters),
  })

  it('counts every variant in one statement, one column each', () => {
    const { sql } = buildRecommendedListCountsSql({
      district: CONGRESSIONAL,
      variants: [
        variant({ hasCellPhone: true }),
        variant({ hasLandline: true }),
        variant({ voterStatus: { in: ['Super'] } }),
      ],
    })

    expect(sql).toMatch(/^SELECT COUNT_IF\(/)
    expect(sql).toContain('AS count_0')
    expect(sql).toContain('AS count_1')
    expect(sql).toContain('AS count_2')
    // One scan: a FROM per variant would be the fan-out this exists to remove.
    expect(sql.match(/ FROM /g)).toHaveLength(1)
  })

  it('applies each variant’s own predicates to its own column', () => {
    const { sql } = buildRecommendedListCountsSql({
      district: CONGRESSIONAL,
      variants: [
        variant({ hasCellPhone: true }),
        variant({ hasLandline: true }),
      ],
    })

    const cell = sql.slice(sql.indexOf('COUNT_IF('), sql.indexOf('AS count_0'))
    const landline = sql.slice(
      sql.indexOf('COUNT_IF(', sql.indexOf('AS count_0')),
      sql.indexOf('AS count_1'),
    )
    expect(cell).toContain('VoterTelephones_CellPhoneFormatted')
    expect(cell).not.toContain('Landline')
    expect(landline).toContain('VoterTelephones_LandlineFormatted')
    expect(landline).not.toContain('CellPhone')
  })

  it('counts a variant with no predicates against the whole district', () => {
    const { sql } = buildRecommendedListCountsSql({
      district: CONGRESSIONAL,
      variants: [variant({})],
    })

    expect(sql).toContain('COUNT_IF(TRUE) AS count_0')
    expect(sql).not.toContain('AND ()')
  })

  // The predicate a variant gets here has to be the one it gets on its own, or
  // the card's size stops agreeing with the list the same filter saves.
  it('binds exactly what the single-variant count binds, in the same order', () => {
    const filters = filtersSchema.parse({
      voterStatus: { in: ['Super', 'Likely'] },
      hasCellPhone: true,
    })
    const overrides = {
      include: ['11111111-1111-4111-8111-111111111111'],
      exclude: ['22222222-2222-4222-8222-222222222222'],
    }

    const single = buildCountSql({
      district: CONGRESSIONAL,
      filters,
      idOverrides: overrides,
    })
    const batched = buildRecommendedListCountsSql({
      district: CONGRESSIONAL,
      variants: [{ filters, idOverrides: overrides }],
    })

    expect(batched.params.map((p) => p.value)).toEqual(
      single.params.map((p) => p.value),
    )
  })

  it('carries the affinity column into the variant it belongs to', () => {
    const { sql } = buildRecommendedListCountsSql({
      district: CONGRESSIONAL,
      variants: [
        variant({ independentAffinity: { eq: 'Yes' } }),
        variant({ hasCellPhone: true }),
      ],
    })

    const affinity = sql.slice(0, sql.indexOf('AS count_1'))
    expect(affinity).toContain(DEFAULT_AFFINITY_COLUMN)
  })

  it('binds the district name rather than interpolating it', () => {
    const { sql, params } = buildRecommendedListCountsSql({
      district: { ...CONGRESSIONAL, districtName: "O'Brien County" },
      variants: [variant({ hasCellPhone: true })],
    })

    expect(sql).not.toContain("O'Brien")
    expect(params.map((p) => p.value)).toContain("O'Brien County")
  })
})
