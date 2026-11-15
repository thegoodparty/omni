import { z } from 'zod'
import {
  ADDRESS_AGREES_POINTS,
  FIRST_NAME_MATCH_POINTS,
  PHONE_AGREES_POINTS,
} from '@/contactUploads/util/contactUploadMatching.util'
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
// firstAliases is the first name's nickname set (firstNameAliases).
export type ContactUploadMatchInputRow = {
  rowIndex: number
  firstKey: string
  firstAliases: string[]
  lastKey: string
  cell: string | null
  landline: string | null
  house: string | null
  streetKey: string | null
  zip: string | null
}

// How a candidate's first name relates to the row's, strongest first.
export const FIRST_NAME_MATCHES = ['exact', 'alias', 'prefix', 'typo'] as const
export type FirstNameMatch = (typeof FIRST_NAME_MATCHES)[number]

export type ContactUploadMatchCandidateRow = {
  rowIndex: number
  personId: string
  firstNameMatch: FirstNameMatch
  phoneAgrees: boolean
  addressAgrees: boolean
  // Every candidate for the row in the district, before the cap of
  // MAX_CANDIDATES_PER_ROW.
  candidateCount: number
}

export const MAX_CANDIDATES_PER_ROW = 10

// Databricks rejects a bound parameter over 1,048,576 characters; this leaves
// headroom under it.
export const CONTACT_UPLOAD_MATCH_INPUT_MAX_CHARS = 800_000

const INPUT_SCHEMA =
  'array<struct<row_index:int,first_key:string,first_aliases:array<string>,' +
  'last_key:string,cell:string,landline:string,house:string,' +
  'street_key:string,zip:string>>'

const EMPTY_FILTERS = filtersSchema.parse({})

const toInputJson = (row: ContactUploadMatchInputRow) => ({
  row_index: row.rowIndex,
  first_key: row.firstKey,
  first_aliases: row.firstAliases,
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
  const firstNameMatchPoints = FIRST_NAME_MATCHES.map(
    (match) => ` WHEN '${match}' THEN ${FIRST_NAME_MATCH_POINTS[match]}`,
  ).join('')
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
    ` CASE WHEN p.first_key = i.first_key THEN 'exact'` +
    ` WHEN array_contains(i.first_aliases, p.first_key) THEN 'alias'` +
    ` WHEN (length(i.first_key) >= 3 AND startswith(p.first_key, i.first_key))` +
    ` OR (length(p.first_key) >= 3 AND startswith(i.first_key, p.first_key)) THEN 'prefix'` +
    ` WHEN levenshtein(p.first_key, i.first_key)` +
    ` <= IF(least(length(p.first_key), length(i.first_key)) < 5, 1, 2) THEN 'typo'` +
    ` END AS first_name_match,` +
    ` coalesce(i.cell IN (p.cell, p.landline), false)` +
    ` OR coalesce(i.landline IN (p.cell, p.landline), false) AS phone_agrees,` +
    ` coalesce(i.house = p.house` +
    ` AND p.street_key LIKE concat(i.street_key, '%')` +
    ` AND (i.zip IS NULL OR i.zip = p.zip), false) AS address_agrees` +
    ` FROM input i JOIN people p ON p.last_key = i.last_key` +
    `), candidates AS (` +
    `SELECT *, count(*) OVER (PARTITION BY row_index) AS candidate_count` +
    ` FROM pairs WHERE first_name_match IS NOT NULL` +
    `)` +
    ` SELECT row_index, id, first_name_match, phone_agrees, address_agrees,` +
    ` candidate_count` +
    ` FROM candidates` +
    ` QUALIFY row_number() OVER (PARTITION BY row_index` +
    ` ORDER BY CASE first_name_match${firstNameMatchPoints} END` +
    ` + IF(phone_agrees, ${PHONE_AGREES_POINTS}, 0)` +
    ` + IF(address_agrees, ${ADDRESS_AGREES_POINTS}, 0) DESC, id)` +
    ` <= ${MAX_CANDIDATES_PER_ROW}`
  return { sql, params: bag.params }
}

export const mapContactUploadMatchRows = (
  rows: Array<Array<string | null>>,
): ContactUploadMatchCandidateRow[] =>
  rows.map((row) => ({
    rowIndex: Number(row[0]),
    personId: row[1] ?? '',
    firstNameMatch: z.enum(FIRST_NAME_MATCHES).parse(row[2]),
    phoneAgrees: row[3] === 'true',
    addressAgrees: row[4] === 'true',
    candidateCount: Number(row[5] ?? 0),
  }))
