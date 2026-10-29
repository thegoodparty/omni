import { describe, expect, it } from 'vitest'
import {
  buildContactUploadMatchSql,
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
  dataset: 'constituents',
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
      rows: [ROW, { ...ROW, rowIndex: 8, firstKey: 'john' }],
    })

    expect(params[0]).toEqual({
      name: 'p0',
      type: 'STRING',
      value: JSON.stringify([
        {
          row_index: 7,
          first_key: 'jane',
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
      "explode(from_json(:p0, 'array<struct<row_index:int,first_key:string,",
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

  it('joins on name keys and computes agreement and the name count', () => {
    const { sql } = buildContactUploadMatchSql({ district: CITY, rows: [ROW] })

    expect(sql).toContain(
      "regexp_replace(lower(v.`FirstName`), '[^a-z]', '') AS first_key",
    )
    expect(sql).toContain(
      "regexp_replace(lower(v.`Residence_Addresses_StreetName`), '[^a-z0-9]', '') AS street_key",
    )
    expect(sql).toContain(
      'ON p.first_key = i.first_key AND p.last_key = i.last_key',
    )
    expect(sql).toContain(
      'coalesce(i.cell IN (p.cell, p.landline), false) OR coalesce(i.landline IN (p.cell, p.landline), false) AS phone_agrees',
    )
    expect(sql).toContain(
      "coalesce(i.house = p.house AND p.street_key LIKE concat(i.street_key, '%') AND (i.zip IS NULL OR i.zip = p.zip), false) AS address_agrees",
    )
    expect(sql).toContain(
      'count(*) OVER (PARTITION BY i.row_index) AS name_count',
    )
    expect(sql).toContain(
      'QUALIFY row_number() OVER (PARTITION BY row_index ORDER BY phone_agrees DESC, address_agrees DESC, id) <= 10',
    )
  })
})

describe('mapContactUploadMatchRows', () => {
  it('reads booleans and counts from the JSON_ARRAY strings', () => {
    expect(
      mapContactUploadMatchRows([
        ['7', 'person-a', 'true', 'false', '3'],
        ['8', 'person-b', 'false', 'true', '1'],
      ]),
    ).toEqual([
      {
        rowIndex: 7,
        personId: 'person-a',
        phoneAgrees: true,
        addressAgrees: false,
        nameCount: 3,
      },
      {
        rowIndex: 8,
        personId: 'person-b',
        phoneAgrees: false,
        addressAgrees: true,
        nameCount: 1,
      },
    ])
  })
})
