import { PEOPLE_DBX_CATALOG, PEOPLE_DBX_SCHEMA } from './peopleDbx.config'
import { createBag, type DbxStatement } from './databricksVoterSql.util'

export type StatsDimensionKey =
  | 'age'
  | 'education'
  | 'homeowner'
  | 'presenceOfChildren'
  | 'estimatedIncomeRange'

export type DistrictStatsBucket = {
  label: string
  count: number
  percent: number
}

export type DistrictStatsBuckets = Record<
  StatsDimensionKey,
  DistrictStatsBucket[]
>

export type ComputedDistrictStats = {
  districtId: string
  updatedAt: Date
  totalConstituents: number
  totalConstituentsWithCellPhone: number
  buckets: DistrictStatsBuckets
}

export const STATS_DIMENSION_KEYS = [
  'age',
  'education',
  'homeowner',
  'presenceOfChildren',
  'estimatedIncomeRange',
] as const satisfies readonly StatsDimensionKey[]

const DISTRICT_STATS_TABLE = `${PEOPLE_DBX_CATALOG}.${PEOPLE_DBX_SCHEMA}.gp_api_district_stats`

// Read the mirrored stats table rather than aggregating the voter rows. It
// carries the same columns as Postgres's DistrictStats and is refreshed on the
// same cadence, so the two stores answer from equivalent snapshots -- and a
// district with no row is absent here too, which is the behavior the product
// depends on. Struct fields are addressed case-insensitively by Spark, and each
// dimension is serialized with to_json so the shape does not depend on how the
// API renders a nested struct.
export const buildDistrictStatsSql = (districtId: string): DbxStatement => {
  const bag = createBag()
  const dimensions = STATS_DIMENSION_KEYS.map(
    (key) => `to_json(buckets.${key}) AS ${key}`,
  ).join(', ')
  const sql =
    `SELECT total_constituents, total_constituents_with_cell_phone,` +
    ` updated_at, ${dimensions}` +
    ` FROM ${DISTRICT_STATS_TABLE}` +
    ` WHERE district_id = ${bag.bind(districtId)}`
  return { sql, params: bag.params }
}

type RawBucket = {
  label?: string | null
  count?: string | number | null
  percent?: string | number | null
}

const parseBuckets = (
  raw: string | null | undefined,
): DistrictStatsBucket[] => {
  if (!raw) return []
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const parsed = JSON.parse(raw) as RawBucket[] | null
  if (!Array.isArray(parsed)) return []
  return parsed.map(({ label, count, percent }) => ({
    label: String(label ?? ''),
    count: Number(count ?? 0),
    percent: Number(percent ?? 0),
  }))
}

// No row means no stats, and that absence is load-bearing product behavior:
// polls gate on it, fetchStatsByDistrictId throws VOTER_DATA_UNAVAILABLE on it,
// and the webapp renders a dedicated "no constituent data for this office yet"
// screen rather than a zero-filled one.
export const mapDistrictStatsRow = (
  districtId: string,
  row: Array<string | null> | undefined,
): ComputedDistrictStats | null => {
  if (!row) return null
  const [total, withCell, updatedAt, ...dimensions] = row
  return {
    districtId,
    updatedAt: updatedAt ? new Date(updatedAt) : new Date(0),
    totalConstituents: Number(total ?? 0),
    totalConstituentsWithCellPhone: Number(withCell ?? 0),
    buckets: {
      age: parseBuckets(dimensions[0]),
      education: parseBuckets(dimensions[1]),
      homeowner: parseBuckets(dimensions[2]),
      presenceOfChildren: parseBuckets(dimensions[3]),
      estimatedIncomeRange: parseBuckets(dimensions[4]),
    },
  }
}
