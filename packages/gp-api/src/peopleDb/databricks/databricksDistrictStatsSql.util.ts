import type { DistrictStats } from '../../generated/people-prisma'
import { lit, VOTER_TABLE, type DbxDistrict } from './databricksVoterSql.util'

type Bucket = { label: string; when: string }

const AGE_COLUMN = 'v.`Age_Int`'
const INCOME_COLUMN = 'v.`Estimated_Income_Amount_Int`'
const EDUCATION_COLUMN = 'v.`Education_Of_Person`'
const HOMEOWNER_COLUMN = 'v.`Homeowner_Probability_Model`'
const CHILDREN_COLUMN = 'v.`Presence_Of_Children`'
const CELL_COLUMN = 'v.`VoterTelephones_CellPhoneFormatted`'

const AGE_BUCKETS: Bucket[] = [
  { label: 'Unknown', when: `${AGE_COLUMN} IS NULL` },
  { label: '18-25', when: `${AGE_COLUMN} <= 25` },
  { label: '26-35', when: `${AGE_COLUMN} > 25 AND ${AGE_COLUMN} <= 35` },
  { label: '36-50', when: `${AGE_COLUMN} > 35 AND ${AGE_COLUMN} <= 50` },
  { label: '51+', when: `${AGE_COLUMN} > 50` },
]

// Labels carry an EN DASH, not a hyphen, and boundaries are [lower, upper) —
// both are what the precomputed DistrictStats row uses, and the webapp keys
// its copy off these exact strings.
const INCOME_BOUNDS: Array<{ label: string; upper: number }> = [
  { label: '1k–15k', upper: 15000 },
  { label: '15k–25k', upper: 25000 },
  { label: '25k–35k', upper: 35000 },
  { label: '35k–50k', upper: 50000 },
  { label: '50k–75k', upper: 75000 },
  { label: '75k–100k', upper: 100000 },
  { label: '100k–125k', upper: 125000 },
  { label: '125k–150k', upper: 150000 },
  { label: '150k–175k', upper: 175000 },
  { label: '175k–200k', upper: 200000 },
  { label: '200k–250k', upper: 250000 },
]

const INCOME_BUCKETS: Bucket[] = [
  { label: 'Unknown', when: `${INCOME_COLUMN} IS NULL` },
  ...INCOME_BOUNDS.map(({ label, upper }, index) => {
    const lower = index === 0 ? null : (INCOME_BOUNDS[index - 1]?.upper ?? 0)
    return {
      label,
      when:
        lower === null
          ? `${INCOME_COLUMN} < ${upper}`
          : `${INCOME_COLUMN} >= ${lower} AND ${INCOME_COLUMN} < ${upper}`,
    }
  }),
  { label: '250k+', when: `${INCOME_COLUMN} >= 250000` },
]

const EDUCATION_VALUES: Array<{ label: string; value: string }> = [
  { label: 'None', value: 'Did Not Complete High School Likely' },
  { label: 'High School Diploma', value: 'Completed High School Likely' },
  {
    label: 'Technical School',
    value: 'Attended Vocational/Technical School Likely',
  },
  {
    label: 'Some College',
    value: 'Attended But Did Not Complete College Likely',
  },
  { label: 'College Degree', value: 'Completed College Likely' },
  { label: 'Graduate Degree', value: 'Completed Graduate School Likely' },
]

const EDUCATION_BUCKETS: Bucket[] = [
  ...EDUCATION_VALUES.map(({ label, value }) => ({
    label,
    when: `${EDUCATION_COLUMN} = ${lit(value)}`,
  })),
  {
    label: 'Unknown',
    when:
      `${EDUCATION_COLUMN} IS NULL OR ${EDUCATION_COLUMN} NOT IN (` +
      `${EDUCATION_VALUES.map(({ value }) => lit(value)).join(', ')})`,
  },
]

// 'Probable Home Owner' folds into Yes here, which deliberately DISAGREES with
// VALUE_MAPPERS.homeowner in filters.sql.util.ts (it maps that value to its own
// 'Likely' bucket). That inconsistency between the stats table and the filter
// pipeline predates this code; reproducing the stats-table behavior is what
// keeps these numbers identical to the ones the product shows today.
const HOMEOWNER_BUCKETS: Bucket[] = [
  {
    label: 'Yes',
    when: `${HOMEOWNER_COLUMN} IN ('Home Owner', 'Probable Home Owner')`,
  },
  { label: 'No', when: `${HOMEOWNER_COLUMN} = 'Renter'` },
  {
    label: 'Unknown',
    when:
      `${HOMEOWNER_COLUMN} IS NULL OR ${HOMEOWNER_COLUMN} NOT IN (` +
      `'Home Owner', 'Probable Home Owner', 'Renter')`,
  },
]

const CHILDREN_BUCKETS: Bucket[] = [
  { label: 'Yes', when: `${CHILDREN_COLUMN} = 'Y'` },
  { label: 'No', when: `${CHILDREN_COLUMN} = 'N'` },
  {
    label: 'Unknown',
    when:
      `${CHILDREN_COLUMN} IS NULL OR ` + `${CHILDREN_COLUMN} NOT IN ('Y', 'N')`,
  },
]

// The bucket shape is declared here rather than reused from
// PrismaJson.DistrictStatsBucketSummary: the generated client annotates the
// column as `PrismaJson.DistrictStatsBuckets`, a name nothing declares, so
// skipLibCheck silently degrades that type to `any` and nothing in this
// mapping would be checked.
export type StatsDimensionKey =
  | 'age'
  | 'education'
  | 'homeowner'
  | 'presenceOfChildren'
  | 'estimatedIncomeRange'

export type DistrictStatsBuckets = Record<
  StatsDimensionKey,
  { buckets: Array<{ label: string; count: number; percent: number }> }
>

export type ComputedDistrictStats = Omit<DistrictStats, 'buckets'> & {
  buckets: DistrictStatsBuckets
}

export const STATS_DIMENSIONS = [
  { key: 'age', buckets: AGE_BUCKETS },
  { key: 'education', buckets: EDUCATION_BUCKETS },
  { key: 'homeowner', buckets: HOMEOWNER_BUCKETS },
  { key: 'presenceOfChildren', buckets: CHILDREN_BUCKETS },
  { key: 'estimatedIncomeRange', buckets: INCOME_BUCKETS },
] as const satisfies ReadonlyArray<{
  key: StatsDimensionKey
  buckets: Bucket[]
}>

// One pass over the district's rows: a count_if per label plus the two totals,
// rather than the precomputed DistrictStats table, which runs 8-22 days stale.
export const buildDistrictStatsSql = (district: DbxDistrict): string => {
  const scope = [`v.\`State\` = ${lit(district.state)}`]
  if (!district.useVoterOnlyPath) {
    scope.push(`v.\`${district.districtType}\` = ${lit(district.districtName)}`)
  }
  const aggregates = [
    'COUNT(*) AS total',
    `COUNT(${CELL_COLUMN}) AS with_cell`,
    ...STATS_DIMENSIONS.flatMap(({ key, buckets }) =>
      buckets.map(({ when }, index) => `count_if(${when}) AS ${key}_${index}`),
    ),
  ]
  return (
    `SELECT ${aggregates.join(', ')} FROM ${VOTER_TABLE} v` +
    ` WHERE ${scope.join(' AND ')}`
  )
}

const toCount = (value: string | null | undefined): number => Number(value ?? 0)

const EMPTY_DIMENSION = { buckets: [] }

// A district with zero voters must come back as null, not a zero-filled row.
// "No stats row" is load-bearing product behavior: polls gate on it,
// fetchStatsByDistrictId throws VOTER_DATA_UNAVAILABLE on it, and the webapp
// renders a dedicated "no constituent data for this office yet" screen. An
// on-demand query can never return null on its own, so the mapping has to.
export const mapDistrictStatsRow = (
  districtId: string,
  row: Array<string | null> | undefined,
  computedAt: Date,
): ComputedDistrictStats | null => {
  if (!row) return null
  const total = toCount(row[0])
  if (total === 0) return null

  let cursor = 2
  const summary: Partial<DistrictStatsBuckets> = {}
  for (const { key, buckets } of STATS_DIMENSIONS) {
    const labelled = buckets.map(({ label }, index) => ({
      label,
      count: toCount(row[cursor + index]),
    }))
    cursor += buckets.length
    summary[key] = {
      buckets: labelled
        // A label nobody falls into is omitted entirely rather than shown as
        // a zero row, which is what the precomputed table does.
        .filter(({ count }) => count > 0)
        .sort((a, b) => (a.label < b.label ? 1 : a.label > b.label ? -1 : 0))
        .map(({ label, count }) => ({
          label,
          count,
          percent: Math.round((count * 10000) / total) / 100,
        })),
    }
  }

  return {
    districtId,
    updatedAt: computedAt,
    totalConstituents: total,
    totalConstituentsWithCellPhone: toCount(row[1]),
    buckets: {
      age: summary.age ?? EMPTY_DIMENSION,
      education: summary.education ?? EMPTY_DIMENSION,
      homeowner: summary.homeowner ?? EMPTY_DIMENSION,
      presenceOfChildren: summary.presenceOfChildren ?? EMPTY_DIMENSION,
      estimatedIncomeRange: summary.estimatedIncomeRange ?? EMPTY_DIMENSION,
    },
  }
}
