import { filtersSchema } from '../schemas/filters.schema'
import {
  buildScopeSql,
  col,
  createBag,
  peopleTable,
  type DbxDistrict,
  type DbxStatement,
} from './databricksVoterSql.util'

// One Import contacts row as the match statement reads it. The keys are
// computed in gp-api (src/contactUploads/util/contactUploadMatching.util.ts)
// the same way the statement computes them for people: names lowercased to
// letters only, street name lowercased to letters and digits.
export type ContactUploadMatchInputRow = {
  rowIndex: number
  firstKey: string
  lastKey: string
  cell: string | null
  landline: string | null
  house: string | null
  streetKey: string | null
  zip: string | null
}

export type ContactUploadMatchCandidateRow = {
  rowIndex: number
  personId: string
  phoneAgrees: boolean
  addressAgrees: boolean
  // Everyone in the district sharing the row's name, before the cap of
  // MAX_CANDIDATES_PER_ROW.
  nameCount: number
}

export const MAX_CANDIDATES_PER_ROW = 10

// Databricks rejects a bound parameter over 1,048,576 characters; this leaves
// headroom under it.
export const CONTACT_UPLOAD_MATCH_INPUT_MAX_CHARS = 800_000

const INPUT_SCHEMA =
  'array<struct<row_index:int,first_key:string,last_key:string,cell:string,' +
  'landline:string,house:string,street_key:string,zip:string>>'

const EMPTY_FILTERS = filtersSchema.parse({})

const toInputJson = (row: ContactUploadMatchInputRow) => ({
  row_index: row.rowIndex,
  first_key: row.firstKey,
  last_key: row.lastKey,
  cell: row.cell,
  landline: row.landline,
  house: row.house,
  street_key: row.streetKey,
  zip: row.zip,
})

// How many leading rows fit in one statement's bound JSON value. Always at
// least one, so a chunk makes progress.
export const fitContactUploadMatchRows = (
  rows: ContactUploadMatchInputRow[],
): number => {
  let chars = 1
  let fitted = 0
  for (const row of rows) {
    chars += JSON.stringify(toInputJson(row)).length + 1
    if (fitted > 0 && chars > CONTACT_UPLOAD_MATCH_INPUT_MAX_CHARS) break
    fitted += 1
  }
  return fitted
}

// Every row of a chunk travels as ONE bound JSON parameter and is exploded in
// the statement, so a chunk is one statement rather than one bound value per
// row (the API caps a statement at 10,000 parameters). The caller sizes the
// chunk with fitContactUploadMatchRows.
//
// Reads the plain people table, never `district.table`: matching is against
// the district's L2 people only. The org's earlier uploads are matched in
// Postgres before this runs, so reading the org's overlay here would match a
// row against itself.
export const buildContactUploadMatchSql = (args: {
  district: DbxDistrict
  rows: ContactUploadMatchInputRow[]
}): DbxStatement => {
  const bag = createBag()
  const input = bag.bind(JSON.stringify(args.rows.map(toInputJson)))
  const scope = buildScopeSql(bag, {
    district: args.district,
    filters: EMPTY_FILTERS,
  })
  const sql =
    `WITH input AS (` +
    `SELECT r.* FROM (SELECT explode(from_json(${input}, '${INPUT_SCHEMA}')) AS r)` +
    `), people AS (` +
    `SELECT ${col('id')} AS id,` +
    ` ${col('VoterTelephones_CellPhoneFormatted')} AS cell,` +
    ` ${col('VoterTelephones_LandlineFormatted')} AS landline,` +
    ` ${col('Residence_Addresses_HouseNumber')} AS house,` +
    ` regexp_replace(lower(${col('Residence_Addresses_StreetName')}), '[^a-z0-9]', '') AS street_key,` +
    ` left(${col('Residence_Addresses_Zip')}, 5) AS zip,` +
    ` regexp_replace(lower(${col('FirstName')}), '[^a-z]', '') AS first_key,` +
    ` regexp_replace(lower(${col('LastName')}), '[^a-z]', '') AS last_key` +
    ` FROM ${peopleTable(args.district.dataset)} v ${scope}` +
    `), pairs AS (` +
    `SELECT i.row_index, p.id,` +
    ` coalesce(i.cell IN (p.cell, p.landline), false)` +
    ` OR coalesce(i.landline IN (p.cell, p.landline), false) AS phone_agrees,` +
    ` coalesce(i.house = p.house` +
    ` AND p.street_key LIKE concat(i.street_key, '%')` +
    ` AND (i.zip IS NULL OR i.zip = p.zip), false) AS address_agrees,` +
    ` count(*) OVER (PARTITION BY i.row_index) AS name_count` +
    ` FROM input i JOIN people p` +
    ` ON p.first_key = i.first_key AND p.last_key = i.last_key` +
    `)` +
    ` SELECT row_index, id, phone_agrees, address_agrees, name_count` +
    ` FROM pairs` +
    ` QUALIFY row_number() OVER (PARTITION BY row_index` +
    ` ORDER BY phone_agrees DESC, address_agrees DESC, id)` +
    ` <= ${MAX_CANDIDATES_PER_ROW}`
  return { sql, params: bag.params }
}

export const mapContactUploadMatchRows = (
  rows: Array<Array<string | null>>,
): ContactUploadMatchCandidateRow[] =>
  rows.map((row) => ({
    rowIndex: Number(row[0]),
    personId: row[1] ?? '',
    phoneAgrees: row[2] === 'true',
    addressAgrees: row[3] === 'true',
    nameCount: Number(row[4] ?? 0),
  }))
