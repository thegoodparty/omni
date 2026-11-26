import { createBag, type DbxStatement } from './databricksVoterSql.util'

// The data team's table of what residents have said, one row per comment,
// keyed by the election database's district id. It sits in a sandbox schema
// until they publish it, so the name is configuration and not a constant.
export const DEFAULT_RESIDENT_VOICES_TABLE =
  'goodparty_data_catalog.sandbox.pro_district_resident_voices'

// A table name cannot be a bound parameter, so it is inlined and held to
// catalog.schema.table.
const QUALIFIED_TABLE_RE = /^[A-Za-z0-9_]+\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/

export const residentVoicesTable = (): string => {
  const table =
    process.env.RESIDENT_VOICES_TABLE || DEFAULT_RESIDENT_VOICES_TABLE
  if (!QUALIFIED_TABLE_RE.test(table)) {
    throw new Error(`Refusing to read resident voices from ${table}`)
  }
  return table
}

// Far above what a district holds (25 at most when this was written), so
// the cap only protects memory if the table ever changes shape.
export const RESIDENT_VOICES_ROW_LIMIT = 1_000

// Only what choosing and showing a comment needs. The table's names, user
// and campaign ids, topic and dates are never selected.
const COLUMNS = [
  'quote_id',
  'quote',
  'is_synthetic',
  'source',
  'tier',
  'display_rank',
  'location_status',
  'lat_fuzzed',
  'lon_fuzzed',
] as const

export type ResidentVoiceRow = {
  id: string
  quote: string
  isSynthetic: boolean
  source: string | null
  tier: number | null
  displayRank: number | null
  locationStatus: string | null
  lat: number | null
  lon: number | null
}

export const buildResidentVoicesSql = (districtId: string): DbxStatement => {
  const bag = createBag()
  const sql =
    `SELECT ${COLUMNS.join(', ')} FROM ${residentVoicesTable()}` +
    ` WHERE district_id = ${bag.bind(districtId)}`
  return { sql, params: bag.params }
}

const numberOrNull = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export const mapResidentVoiceRows = (
  rows: ReadonlyArray<ReadonlyArray<string | null>>,
): ResidentVoiceRow[] =>
  rows.flatMap((row): ResidentVoiceRow[] => {
    const [id, quote, isSynthetic, source, tier, rank, status, lat, lon] = row
    return id && quote?.trim()
      ? [
          {
            id,
            quote: quote.trim(),
            isSynthetic: isSynthetic === 'true',
            source: source ?? null,
            tier: numberOrNull(tier),
            displayRank: numberOrNull(rank),
            locationStatus: status ?? null,
            lat: numberOrNull(lat),
            lon: numberOrNull(lon),
          },
        ]
      : []
  })
