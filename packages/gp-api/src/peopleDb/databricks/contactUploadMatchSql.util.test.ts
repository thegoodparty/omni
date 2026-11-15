import { describe, expect, it } from 'vitest'
import {
  buildContactUploadMatchSql,
  CONTACT_UPLOAD_MATCH_INPUT_MAX_CHARS,
  fitContactUploadMatchRows,
  mapContactUploadMatchRows,
} from './contactUploadMatchSql.util'
import type { DbxDistrict } from './databricksVoterSql.util'

const CONSTITUENTS_TABLE =
  'goodparty_data_catalog.mart_gp_api.gp_api_constituents'

const CITY: DbxDistrict = {
  districtId: '635757db-0000-0000-0000-000000000000',
  state: 'MI',
  districtType: 'City',
  districtName: 'GRAND RAPIDS CITY',
  useVoterOnlyPath: false,
  dataset: { base: 'constituents' },
  table: '(SELECT * FROM some_overlay_join)',
}

const STATEWIDE: DbxDistrict = {
  ...CITY,
  districtType: 'State',
  districtName: 'MI',
  useVoterOnlyPath: true,
}

const ROW = {
  rowIndex: 7,
  firstKey: 'jane',
  firstAliases: ['jane', 'janet', 'jenny'],
  lastKey: 'doe',
  cell: '(616) 555-0142',
  landline: null,
  house: '123',
  streetKey: 'oak',
  zip: '49503',
}

describe('buildContactUploadMatchSql', () => {
  it('binds every row as one JSON parameter and explodes it', () => {
    const { sql, params } = buildContactUploadMatchSql({
      district: CITY,
      rows: [
        ROW,
        { ...ROW, rowIndex: 8, firstKey: 'john', firstAliases: ['john'] },
      ],
    })

    expect(params[0]).toEqual({
      name: 'p0',
      type: 'STRING',
      value: JSON.stringify([
        {
          row_index: 7,
          first_key: 'jane',
          first_aliases: ['jane', 'janet', 'jenny'],
          last_key: 'doe',
          cell: '(616) 555-0142',
          landline: null,
          house: '123',
          street_key: 'oak',
          zip: '49503',
        },
        {
          row_index: 8,
          first_key: 'john',
          first_aliases: ['john'],
          last_key: 'doe',
          cell: '(616) 555-0142',
          landline: null,
          house: '123',
          street_key: 'oak',
          zip: '49503',
        },
      ]),
    })
    expect(sql).toContain(
      "explode(from_json(:p0, 'array<struct<row_index:int,first_key:string,first_aliases:array<string>,",
    )
  })

  it('reads the plain people table scoped to the district, not district.table', () => {
    const { sql, params } = buildContactUploadMatchSql({
      district: CITY,
      rows: [ROW],
    })

    expect(sql).toContain(
      `FROM ${CONSTITUENTS_TABLE} v WHERE v.\`State\` = :p1 AND v.\`City\` = :p2`,
    )
    expect(sql).not.toContain('some_overlay_join')
    expect(params.slice(1).map((param) => param.value)).toEqual([
      'MI',
      'GRAND RAPIDS CITY',
    ])
  })

  it('scopes a statewide district on State alone', () => {
    const { sql, params } = buildContactUploadMatchSql({
      district: STATEWIDE,
      rows: [ROW],
    })

    expect(sql).toContain(
      `FROM ${CONSTITUENTS_TABLE} v WHERE v.\`State\` = :p1)`,
    )
    expect(params).toHaveLength(2)
  })

  it('joins on last name and grades the first name exact, alias, prefix or typo', () => {
    const { sql } = buildContactUploadMatchSql({ district: CITY, rows: [ROW] })

    expect(sql).toContain(
      "regexp_replace(lower(v.`FirstName`), '[^a-z]', '') AS first_key",
    )
    expect(sql).toContain(
      "regexp_replace(lower(v.`Residence_Addresses_StreetName`), '[^a-z0-9]', '') AS street_key",
    )
    expect(sql).toContain(
      'FROM input i JOIN people p ON p.last_key = i.last_key)',
    )
    expect(sql).toContain(
      "CASE WHEN p.first_key = i.first_key THEN 'exact'" +
        " WHEN array_contains(i.first_aliases, p.first_key) THEN 'alias'" +
        ' WHEN (length(i.first_key) >= 3 AND startswith(p.first_key, i.first_key))' +
        " OR (length(p.first_key) >= 3 AND startswith(i.first_key, p.first_key)) THEN 'prefix'" +
        ' WHEN levenshtein(p.first_key, i.first_key)' +
        " <= IF(least(length(p.first_key), length(i.first_key)) < 5, 1, 2) THEN 'typo'" +
        ' END AS first_name_match',
    )
    expect(sql).toContain(
      'coalesce(i.cell IN (p.cell, p.landline), false) OR coalesce(i.landline IN (p.cell, p.landline), false) AS phone_agrees',
    )
    expect(sql).toContain(
      "coalesce(i.house = p.house AND p.street_key LIKE concat(i.street_key, '%') AND (i.zip IS NULL OR i.zip = p.zip), false) AS address_agrees",
    )
    expect(sql).toContain(
      'count(*) OVER (PARTITION BY row_index) AS candidate_count FROM pairs WHERE first_name_match IS NOT NULL',
    )
  })

  it('keeps the ten strongest by the points decideFromCandidates scores', () => {
    const { sql } = buildContactUploadMatchSql({ district: CITY, rows: [ROW] })

    expect(sql).toContain(
      'QUALIFY row_number() OVER (PARTITION BY row_index ORDER BY' +
        " CASE first_name_match WHEN 'exact' THEN 30 WHEN 'alias' THEN 20" +
        " WHEN 'prefix' THEN 15 WHEN 'typo' THEN 5 END" +
        ' + IF(phone_agrees, 20, 0) + IF(address_agrees, 20, 0) DESC, id) <= 10',
    )
  })
})

describe('fitContactUploadMatchRows', () => {
  const DATABRICKS_PARAMETER_MAX_CHARS = 1_048_576
  const worstCase = Array.from({ length: 20_000 }, (_, index) => ({
    rowIndex: 99_999 - index,
    firstKey: 'a'.repeat(60),
    firstAliases: Array.from({ length: 50 }, () => 'a'.repeat(10)),
    lastKey: 'b'.repeat(60),
    cell: '(616) 555-0142',
    landline: '(616) 555-0143',
    house: '123456',
    streetKey: 'c'.repeat(40),
    zip: '49503',
  }))

  it('keeps a worst-case chunk under the Databricks parameter limit', () => {
    const fitted = fitContactUploadMatchRows(worstCase)
    const { params } = buildContactUploadMatchSql({
      district: CITY,
      rows: worstCase.slice(0, fitted),
    })
    const { params: oneMore } = buildContactUploadMatchSql({
      district: CITY,
      rows: worstCase.slice(0, fitted + 1),
    })

    expect(fitted).toBeLessThan(worstCase.length)
    expect(params[0]?.value?.length).toBeLessThanOrEqual(
      CONTACT_UPLOAD_MATCH_INPUT_MAX_CHARS,
    )
    expect(oneMore[0]?.value?.length).toBeGreaterThan(
      CONTACT_UPLOAD_MATCH_INPUT_MAX_CHARS,
    )
    expect(CONTACT_UPLOAD_MATCH_INPUT_MAX_CHARS).toBeLessThan(
      DATABRICKS_PARAMETER_MAX_CHARS,
    )
  })

  it('takes every row of a chunk that fits', () => {
    expect(fitContactUploadMatchRows([ROW, ROW, ROW])).toBe(3)
  })

  it('takes one row even when that row alone is over the budget', () => {
    expect(
      fitContactUploadMatchRows([
        { ...ROW, firstKey: 'a'.repeat(CONTACT_UPLOAD_MATCH_INPUT_MAX_CHARS) },
        ROW,
      ]),
    ).toBe(1)
  })
})

describe('mapContactUploadMatchRows', () => {
  it('reads the first-name match, booleans and counts from the JSON_ARRAY strings', () => {
    expect(
      mapContactUploadMatchRows([
        ['7', 'person-a', 'alias', 'true', 'false', '3'],
        ['8', 'person-b', 'typo', 'false', 'true', '1'],
      ]),
    ).toEqual([
      {
        rowIndex: 7,
        personId: 'person-a',
        firstNameMatch: 'alias',
        phoneAgrees: true,
        addressAgrees: false,
        candidateCount: 3,
      },
      {
        rowIndex: 8,
        personId: 'person-b',
        firstNameMatch: 'typo',
        phoneAgrees: false,
        addressAgrees: true,
        candidateCount: 1,
      },
    ])
  })

  it('rejects a first-name match it does not know', () => {
    expect(() =>
      mapContactUploadMatchRows([
        ['7', 'person-a', 'fuzzy', 'true', 'false', '1'],
      ]),
    ).toThrow()
  })
})
