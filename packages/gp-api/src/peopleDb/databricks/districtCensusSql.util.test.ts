import { describe, expect, it } from 'vitest'
import {
  ACS_COUNT_COLUMNS,
  ACS_COUNT_KEYS,
  BLOCK_GROUP_DEMOGRAPHICS_TABLE,
  buildDistrictCensusSql,
  buildDistrictCompositionSql,
  buildDistrictTractAdultsSql,
  buildRespondentBlockGroupsSql,
  buildRespondentCellsSql,
  CENSUS_TABLE,
  DISTRICT_DEMOGRAPHICS_TABLE,
  mapCensusCompositionRows,
  mapRespondentCells,
  mapTractAdults,
} from './districtCensusSql.util'
import type { DbxDistrict } from './databricksVoterSql.util'

const VOTERS_TABLE = 'goodparty_data_catalog.mart_gp_api.gp_api_voters'

const DISTRICT: DbxDistrict = {
  districtId: 'd-1',
  state: 'WA',
  districtType: 'Water_District',
  districtName: 'EAST WENATCHEE WATER',
  useVoterOnlyPath: false,
  dataset: 'voters',
  table: VOTERS_TABLE,
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

const ID_A = '0190a1b2-0000-7000-8000-00000000000a'
const ID_B = '0190a1b2-0000-7000-8000-00000000000b'

const acsRow = (value: (index: number) => string | null) =>
  ACS_COUNT_KEYS.map((_, index) => value(index))

describe('buildDistrictCompositionSql', () => {
  it('reads the ACS counts from the district demographics mart, keyed and bound like the census lookup', () => {
    const { sql, params } = buildDistrictCompositionSql(DISTRICT)

    expect(DISTRICT_DEMOGRAPHICS_TABLE).toBe(
      'goodparty_data_catalog.mart_gp_api.gp_api_district_census_demographics',
    )
    expect(sql).toContain(`FROM ${DISTRICT_DEMOGRAPHICS_TABLE} d`)
    expect(sql).toContain(
      ' WHERE d.state_postal_code = :p0 AND d.district_type = :p1' +
        ' AND d.district_name = :p2',
    )
    expect(params.map((p) => p.value)).toEqual([
      'WA',
      'Water_District',
      'EAST WENATCHEE WATER',
    ])
    expect(sql).not.toContain('_moe')
  })

  it('selects one column per ACS count key, in key order', () => {
    const { sql } = buildDistrictCompositionSql(DISTRICT)
    const selected = sql
      .slice('SELECT '.length, sql.indexOf(' FROM'))
      .split(', ')
    expect(selected).toEqual(
      ACS_COUNT_KEYS.map((key) => `d.${ACS_COUNT_COLUMNS[key]}`),
    )
    expect(selected).toContain('d.households_income_under_10k')
    expect(selected).toContain('d.households_income_200k_plus')
    expect(ACS_COUNT_KEYS).toHaveLength(34)
  })
})

describe('buildRespondentBlockGroupsSql', () => {
  it('counts the people per block group in the district and joins the block group mart', () => {
    const { sql, params } = buildRespondentBlockGroupsSql(DISTRICT, [
      ID_A,
      ID_B.toUpperCase(),
    ])

    expect(sql).toContain(
      'SELECT r.respondents, bg.total_population, bg.population_under_18',
    )
    expect(sql).toContain(
      'SELECT v.`Census_Block_Group_Geoid` AS block_group_geoid,' +
        ' count(*) AS respondents',
    )
    expect(sql).toContain(`FROM ${VOTERS_TABLE} v WHERE`)
    expect(sql).toContain('v.`State` = :p0')
    expect(sql).toContain('v.`Water_District` = :p1')
    expect(sql).toContain(`v.\`id\` IN ('${ID_A}', '${ID_B}')`)
    expect(sql).toContain('AND v.`Census_Block_Group_Geoid` IS NOT NULL')
    expect(sql).toContain('GROUP BY v.`Census_Block_Group_Geoid`')
    expect(sql).toContain(
      `JOIN ${BLOCK_GROUP_DEMOGRAPHICS_TABLE} bg` +
        ' ON bg.block_group_geoid = r.block_group_geoid',
    )
    expect(params.map((p) => p.value)).toEqual(['WA', 'EAST WENATCHEE WATER'])
  })

  it('reads the people table the district was resolved with', () => {
    const constituents =
      'goodparty_data_catalog.mart_gp_api.gp_api_constituents'
    const { sql } = buildRespondentBlockGroupsSql(
      { ...DISTRICT, dataset: 'constituents', table: constituents },
      [ID_A],
    )
    expect(sql).toContain(`FROM ${constituents} v WHERE`)
  })
})

describe('mapCensusCompositionRows', () => {
  it('maps a full district row and expands each block group by its respondents', () => {
    const blockGroup = acsRow((index) => String(index))

    const mapped = mapCensusCompositionRows(
      [acsRow((index) => String(1000 + index + 0.5))],
      [
        ['3', ...blockGroup],
        ['1', ...acsRow((index) => String(index * 2))],
      ],
    )

    expect(mapped.district?.totalPopulation).toBe(1000.5)
    expect(mapped.district?.householdsIncome200kPlus).toBe(1033.5)
    expect(mapped.respondentBlockGroups).toHaveLength(4)
    expect(mapped.respondentBlockGroups[0]?.population65Plus).toBe(2)
    expect(mapped.respondentBlockGroups[3]?.population65Plus).toBe(4)
  })

  it('keeps a suppressed column as null, never zero', () => {
    const mapped = mapCensusCompositionRows(
      [acsRow((index) => (index === 1 ? null : '10'))],
      [['1', ...acsRow((index) => (index === 2 ? null : '5'))]],
    )

    expect(mapped.district?.populationUnder18).toBeNull()
    expect(mapped.district?.totalPopulation).toBe(10)
    expect(mapped.respondentBlockGroups[0]?.population65Plus).toBeNull()
  })

  it('maps a missing district row to null', () => {
    const mapped = mapCensusCompositionRows([], [['2', ...acsRow(() => '1')]])
    expect(mapped.district).toBeNull()
    expect(mapped.respondentBlockGroups).toHaveLength(2)
  })
})

const PERSON_ID = '0b9d1c2e-3f4a-4b5c-8d6e-7f8091a2b3c4'

describe('buildRespondentCellsSql', () => {
  it('reads counts per age band, gender, tenure and tract, never a person', () => {
    const { sql } = buildRespondentCellsSql(DISTRICT, [PERSON_ID])

    expect(sql).toContain(`FROM ${VOTERS_TABLE} v`)
    expect(sql).toContain('count(*) AS respondents')
    expect(sql).toContain('GROUP BY 1, 2, 3, 4')
    expect(sql).toContain(PERSON_ID)
    expect(sql).toContain("THEN '65plus'")
    expect(sql).toContain("THEN 'renter'")
    expect(sql).not.toMatch(/FirstName|LastName|Phone|Address/)
  })
})

describe('buildDistrictTractAdultsSql', () => {
  it('sums adults per tract over the block groups the district lives in', () => {
    const { sql } = buildDistrictTractAdultsSql(DISTRICT)

    expect(sql).toContain(`FROM ${BLOCK_GROUP_DEMOGRAPHICS_TABLE} bg`)
    expect(sql).toContain(
      'sum(bg.total_population - bg.population_under_18) AS adults',
    )
    expect(sql).toContain('substr(bg.block_group_geoid, 1, 11)')
    expect(sql).toContain(`FROM ${VOTERS_TABLE} v`)
  })
})

describe('mapRespondentCells', () => {
  it('keeps unknowns as null and counts as numbers', () => {
    expect(
      mapRespondentCells([
        ['65plus', 'female', 'owner', '53017950100', '4'],
        [null, null, null, null, '2'],
      ]),
    ).toEqual([
      {
        ageBand: '65plus',
        gender: 'female',
        tenure: 'owner',
        tract: '53017950100',
        count: 4,
      },
      { ageBand: null, gender: null, tenure: null, tract: null, count: 2 },
    ])
  })
})

describe('mapTractAdults', () => {
  it('drops tracts with no adults or no figure', () => {
    const tracts = mapTractAdults([
      ['53017950100', '1200'],
      ['53017950200', null],
      ['53017950300', '0'],
    ])
    expect([...tracts]).toEqual([['53017950100', 1200]])
  })
})
