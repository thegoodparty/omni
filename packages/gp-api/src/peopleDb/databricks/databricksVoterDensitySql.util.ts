import type { VoterDensityCell } from '../services/voterDensity.service'
import { createBag, type DbxStatement } from './databricksVoterSql.util'
import { PEOPLE_DBX_CATALOG, PEOPLE_DBX_SCHEMA } from './peopleDbx.config'

const TABLE = (name: string): string =>
  `${PEOPLE_DBX_CATALOG}.${PEOPLE_DBX_SCHEMA}.${name}`

const DENSITY_TABLE = TABLE('gp_api_district_voter_density')
const DENSITY_META_TABLE = TABLE('gp_api_district_voter_density_meta')

// The mart types district_id as STRING where Postgres types it uuid. Postgres
// normalizes case as part of the uuid comparison; a STRING comparison does not,
// so an uppercase id would match no rows and report an empty district rather
// than failing. Same normalization the voter path applies for the same reason.
const normalizeId = (districtId: string): string => districtId.toLowerCase()

// Reads the precomputed, k-anonymized cells. There is no H3 math here and no
// voter row is touched: the pipeline already binned voters to cells, suppressed
// the ones under K, and stored each surviving cell's centroid, so this is the
// same keyed lookup the Postgres arm performs against the loaded mirror.
//
// ORDER BY matches the Postgres arm's (lat, lng) so identical requests return
// identical payloads from either store, and so the dual-read fingerprints
// compare like for like.
export const buildVoterDensitySql = (
  districtId: string,
  resolution: number,
): DbxStatement => {
  const bag = createBag()
  const sql =
    `SELECT lat, lng, voter_count` +
    ` FROM ${DENSITY_TABLE}` +
    ` WHERE district_id = ${bag.bind(normalizeId(districtId))}` +
    ` AND resolution = ${bag.bind(resolution, 'INT')}` +
    ` ORDER BY lat, lng`
  return { sql, params: bag.params }
}

// One row per (district, resolution), or none. "No row" is meaningful: it means
// the pipeline never published this pair, which the public page treats as
// do-not-render, so it must stay distinguishable from a coverage of 0.
export const buildVoterDensityMetaSql = (
  districtId: string,
  resolution: number,
): DbxStatement => {
  const bag = createBag()
  const sql =
    `SELECT coverage` +
    ` FROM ${DENSITY_META_TABLE}` +
    ` WHERE district_id = ${bag.bind(normalizeId(districtId))}` +
    ` AND resolution = ${bag.bind(resolution, 'INT')}`
  return { sql, params: bag.params }
}

// Rows arrive positionally as strings under JSON_ARRAY, so each column is
// coerced here rather than trusted from a driver's typing.
export const mapVoterDensityCells = (
  rows: Array<Array<string | null>>,
): VoterDensityCell[] => {
  const cells: VoterDensityCell[] = []
  for (const [lat, lng, count] of rows) {
    // A cell with no centroid cannot be drawn, and Number(null) is 0 rather
    // than NaN, which would place it off the coast of Africa instead of
    // failing. Neither column is nullable in the mart; this is the guard for
    // that stopping being true.
    if (lat === null || lng === null) continue
    cells.push({ lat: Number(lat), lng: Number(lng), count: Number(count) })
  }
  return cells
}

export const mapVoterDensityCoverage = (
  rows: Array<Array<string | null>>,
): number | null => {
  const coverage = rows[0]?.[0]
  return coverage === null || coverage === undefined ? null : Number(coverage)
}
