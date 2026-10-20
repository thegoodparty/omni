import { describe, expect, it } from 'vitest'
import {
  ACS_COUNT_COLUMNS,
  ACS_COUNT_KEYS,
  BLOCK_GROUP_DEMOGRAPHICS_TABLE,
  buildAnswerCellsSql,
  buildDistrictCellsSql,
  buildDistrictCensusSql,
  buildDistrictCompositionSql,
  buildDistrictTractAdultsSql,
  buildPoolCellsSql,
  buildRespondentBlockGroupsSql,
  buildRespondentCellsSql,
  buildTractGridCellsSql,
  CENSUS_TABLE,
  DISTRICT_DEMOGRAPHICS_TABLE,
  mapAnswerCells,
  mapCensusCompositionRows,
  mapDistrictCells,
  mapGridCells,
  mapRespondentCells,
  mapTractAdults,
  sampleWeightSql,
} from './districtCensusSql.util'
import { createBag, type DbxDistrict } from './databricksVoterSql.util'
import { filtersSchema } from '../schemas/filters.schema'

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
        ' count(*) AS respondents FROM',
    )
    expect(sql).not.toMatch(/age_band|tenure|EthnicGroups/)
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
  it('reads counts per age band, gender, tenure, tract and race, never a person', () => {
    const { sql } = buildRespondentCellsSql(DISTRICT, [PERSON_ID])

    expect(sql).toContain(`FROM ${VOTERS_TABLE} v`)
    expect(sql).toContain('count(*) AS respondents')
    expect(sql).toContain('GROUP BY 1, 2, 3, 4, 5')
    expect(sql).toContain(
      "CASE WHEN v.`EthnicGroups_EthnicGroup1Desc` = 'European' THEN 'white'",
    )
    expect(sql).toContain("= 'Likely African-American' THEN 'black'")
    expect(sql).toContain("= 'Hispanic and Portuguese' THEN 'hispanic'")
    expect(sql).toContain("= 'East and South Asian' THEN 'asian'")
    expect(sql).toContain("= 'Other' THEN 'other' END AS race")
    expect(sql).toContain(PERSON_ID)
    expect(sql).toContain("THEN '65plus'")
    expect(sql).toContain("THEN 'renter'")
    expect(sql).not.toMatch(/FirstName|LastName|Phone|Address/)
  })
})

describe('buildPoolCellsSql', () => {
  it('counts the people a filter matches per age band, gender, tract and race', () => {
    const { sql, params } = buildPoolCellsSql({
      district: DISTRICT,
      filters: filtersSchema.parse({
        hasCellPhone: true,
        id: { notIn: [PERSON_ID] },
      }),
    })

    expect(sql).toMatch(
      /^SELECT CASE WHEN .* AS age_band, CASE WHEN .* AS gender, substr\(v\.`Census_Block_Group_Geoid`, 1, 11\) AS tract, CASE WHEN .* AS race, count\(\*\) AS people FROM /,
    )
    expect(sql).toContain(`FROM ${VOTERS_TABLE} v WHERE v.\`State\` = :p0`)
    expect(sql).toContain('v.`VoterTelephones_CellPhoneFormatted` IS NOT NULL')
    expect(sql).toContain("= 'Likely African-American' THEN 'black'")
    expect(sql.endsWith(' GROUP BY 1, 2, 3, 4')).toBe(true)
    expect(sql).not.toContain('tenure')
    expect(sql).not.toMatch(/FirstName|LastName|AddressLine/)
    expect(params[0]).toEqual({ name: 'p0', value: 'WA', type: 'STRING' })
    expect(sql).toContain(PERSON_ID)
  })
})

describe('buildDistrictCellsSql', () => {
  it('counts the district by age band, gender, tract and race, never a person', () => {
    const { sql, params } = buildDistrictCellsSql(DISTRICT)

    expect(sql).toBe(
      "SELECT CASE WHEN v.`Age_Int` >= 65 THEN '65plus'" +
        " WHEN v.`Age_Int` >= 18 THEN '18to64' END AS age_band," +
        " CASE WHEN v.`Gender` = 'M' THEN 'male'" +
        " WHEN v.`Gender` = 'F' THEN 'female' END AS gender," +
        ' substr(v.`Census_Block_Group_Geoid`, 1, 11) AS tract,' +
        " CASE WHEN v.`EthnicGroups_EthnicGroup1Desc` = 'European' THEN 'white'" +
        " WHEN v.`EthnicGroups_EthnicGroup1Desc` = 'Likely African-American'" +
        " THEN 'black'" +
        " WHEN v.`EthnicGroups_EthnicGroup1Desc` = 'Hispanic and Portuguese'" +
        " THEN 'hispanic'" +
        " WHEN v.`EthnicGroups_EthnicGroup1Desc` = 'East and South Asian'" +
        " THEN 'asian'" +
        " WHEN v.`EthnicGroups_EthnicGroup1Desc` = 'Other' THEN 'other' END" +
        ' AS race, count(*) AS people' +
        ` FROM ${VOTERS_TABLE} v` +
        ' WHERE v.`State` = :p0 AND v.`Water_District` = :p1' +
        ' GROUP BY 1, 2, 3, 4',
    )
    expect(params.map((p) => p.value)).toEqual(['WA', 'EAST WENATCHEE WATER'])
  })

  it('reads the people table the district was resolved with', () => {
    const constituents =
      'goodparty_data_catalog.mart_gp_api.gp_api_constituents'
    const { sql } = buildDistrictCellsSql({
      ...DISTRICT,
      dataset: 'constituents',
      table: constituents,
    })
    expect(sql).toContain(`FROM ${constituents} v WHERE`)
  })
})

describe('buildAnswerCellsSql', () => {
  const YES = '0b9d1c2e-3f4a-4b5c-8d6e-7f8091a2b3c1'
  const MIXED = '0b9d1c2e-3f4a-4b5c-8d6e-7f8091a2b3c2'
  const NO = '0b9d1c2e-3f4a-4b5c-8d6e-7f8091a2b3c3'

  it('sums yeses and answers per cell over the given people only', () => {
    const { sql, params } = buildAnswerCellsSql(DISTRICT, [
      { personId: YES, yes: 1 },
      { personId: MIXED, yes: 0.5 },
      { personId: NO, yes: 0 },
    ])

    expect(sql).toContain(
      `sum(CASE WHEN v.\`id\` IN ('${YES}') THEN CAST(:p2 AS DOUBLE)` +
        ` WHEN v.\`id\` IN ('${MIXED}') THEN CAST(:p3 AS DOUBLE)` +
        ' ELSE 0.0 END) AS yes, count(*) AS answers',
    )
    expect(sql).toContain(`v.\`id\` IN ('${YES}', '${MIXED}', '${NO}')`)
    expect(sql).toContain(' AS race,')
    expect(sql).toContain('GROUP BY 1, 2, 3, 4')
    expect(sql).not.toMatch(/FirstName|LastName|Phone|Address/)
    expect(params.map((p) => p.value)).toEqual([
      'WA',
      'EAST WENATCHEE WATER',
      '1',
      '0.5',
    ])
  })

  it('reads every answer as no when nobody said yes', () => {
    const { sql } = buildAnswerCellsSql(DISTRICT, [{ personId: NO, yes: 0 }])
    expect(sql).toContain('sum(0.0) AS yes')
  })

  it('refuses an id it could not inline safely', () => {
    expect(() =>
      buildAnswerCellsSql(DISTRICT, [{ personId: "x' OR 1=1", yes: 1 }]),
    ).toThrow()
  })
})

describe('mapDistrictCells', () => {
  it('maps each row to a cell, unknowns staying null', () => {
    expect(
      mapDistrictCells([
        ['18to64', 'male', '53017950100', 'hispanic', '12'],
        [null, null, null, null, '3'],
      ]),
    ).toEqual([
      {
        ageBand: '18to64',
        gender: 'male',
        tract: '53017950100',
        race: 'hispanic',
        count: 12,
      },
      { ageBand: null, gender: null, tract: null, race: null, count: 3 },
    ])
  })
})

describe('mapAnswerCells', () => {
  it('keeps a fractional yes', () => {
    expect(
      mapAnswerCells([['65plus', 'female', null, 'asian', '2.5', '4']]),
    ).toEqual([
      {
        ageBand: '65plus',
        gender: 'female',
        tract: null,
        race: 'asian',
        yes: 2.5,
        count: 4,
      },
    ])
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
        ['65plus', 'female', 'owner', '53017950100', 'black', '4'],
        [null, null, null, null, null, '2'],
      ]),
    ).toEqual([
      {
        ageBand: '65plus',
        gender: 'female',
        tenure: 'owner',
        tract: '53017950100',
        race: 'black',
        count: 4,
      },
      {
        ageBand: null,
        gender: null,
        tenure: null,
        tract: null,
        race: null,
        count: 2,
      },
    ])
  })
})

describe('buildTractGridCellsSql', () => {
  it('reads grid squares for the tracts, binding each tract', () => {
    const { sql, params } = buildTractGridCellsSql(
      DISTRICT,
      ['53017950100', '53017950200'],
      0.004,
    )
    expect(sql).toContain('SELECT DISTINCT floor(')
    expect(sql).toContain('/ 0.004) AS grid_row')
    expect(sql).toContain(`FROM ${VOTERS_TABLE} v`)
    expect(params.map((p) => p.value)).toEqual([
      'WA',
      'EAST WENATCHEE WATER',
      '53017950100',
      '53017950200',
    ])
    expect(sql).not.toMatch(/FirstName|LastName|Phone|Address_Line/)
  })
})

describe('mapGridCells', () => {
  it('drops rows without both indexes', () => {
    expect(
      mapGridCells([
        ['9000', '-20000'],
        [null, '1'],
      ]),
    ).toEqual([{ row: 9000, col: -20000 }])
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

describe('sampleWeightSql', () => {
  const weights = {
    age: { '18to64': 0.8, '65plus': 2 },
    gender: {},
    tract: { '53017950100': 1, '53017950200': 1.5 },
    race: {},
    minWeight: 0.5,
    maxWeight: 2,
  }

  it('multiplies age and tract factors within the bounds, all bound', () => {
    const bag = createBag()
    const sql = sampleWeightSql(bag, weights)
    expect(sql).toBe(
      'least(CAST(:p7 AS DOUBLE), greatest(CAST(:p6 AS DOUBLE),' +
        " CASE CASE WHEN v.`Age_Int` >= 65 THEN '65plus'" +
        " WHEN v.`Age_Int` >= 18 THEN '18to64' END" +
        ' WHEN :p0 THEN CAST(:p1 AS DOUBLE)' +
        ' WHEN :p2 THEN CAST(:p3 AS DOUBLE) ELSE 1.0 END *' +
        ' CASE substr(v.`Census_Block_Group_Geoid`, 1, 11)' +
        ' WHEN :p4 THEN CAST(:p5 AS DOUBLE) ELSE 1.0 END))',
    )
    // A factor of 1 and an empty dimension add nothing.
    expect(bag.params.map((p) => p.value)).toEqual([
      '18to64',
      '0.8',
      '65plus',
      '2',
      '53017950200',
      '1.5',
      '0.5',
      '2',
    ])
  })

  it('weighs everyone the same when no factor moves', () => {
    expect(
      sampleWeightSql(createBag(), {
        ...weights,
        age: {},
        tract: { '53017950100': 1 },
      }),
    ).toBe('1.0')
  })

  it('adds a race factor when one moves', () => {
    const bag = createBag()
    const sql = sampleWeightSql(bag, {
      ...weights,
      age: {},
      tract: {},
      race: { black: 1.6, white: 1 },
    })
    expect(sql).toContain(
      "CASE CASE WHEN v.`EthnicGroups_EthnicGroup1Desc` = 'European'",
    )
    expect(sql).toContain('WHEN :p0 THEN CAST(:p1 AS DOUBLE) ELSE 1.0 END')
    expect(bag.params.map((p) => p.value)).toEqual(['black', '1.6', '0.5', '2'])
  })
})
