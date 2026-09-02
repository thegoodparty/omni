import {
  buildScopeSql,
  col,
  createBag,
  VOTER_TABLE,
  type DbxDistrict,
  type DbxStatement,
} from './databricksVoterSql.util'
import { VALUE_MAPPERS } from '../utils/valueMappers.util'

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

// Raw voter-file value -> the label the stats table publishes. Derived from
// VALUE_MAPPERS rather than restated, so a change to the filter vocabulary
// cannot leave a stats bucket labelled by the old one. VALUE_MAPPERS runs
// label -> raw (and homeowner fans one label out to two raw values), so this
// inverts it; the first label to claim a raw value wins, which is why the
// arrays below list the canonical label before any legacy synonym.
const STATS_LABELS = {
  education: [
    'None',
    'High School Diploma',
    'Technical School',
    'Some College',
    'College Degree',
    'Graduate Degree',
  ],
  homeowner: ['Yes', 'No'],
  presenceOfChildren: ['Yes', 'No'],
} as const

const UNKNOWN = 'Unknown'

const invert = (
  labels: readonly string[],
  toRaw: (label: string) => string | string[] | null,
): Map<string, string> => {
  const out = new Map<string, string>()
  for (const label of labels) {
    const raw = toRaw(label)
    if (raw === null) continue
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      if (!out.has(value)) out.set(value, label)
    }
  }
  return out
}

const RAW_TO_LABEL = {
  education: invert(STATS_LABELS.education, VALUE_MAPPERS.educationLevel),
  homeowner: invert(STATS_LABELS.homeowner, VALUE_MAPPERS.homeowner),
  presenceOfChildren: invert(
    STATS_LABELS.presenceOfChildren,
    VALUE_MAPPERS.presenceOfChildren,
  ),
}

// Spark has no parameter binding for an arbitrary CASE arm's comparand here, so
// raw values are quoted. They come from VALUE_MAPPERS, not from a caller.
const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`

const mappedCase = (field: string, mapping: Map<string, string>): string => {
  const arms = [...mapping.entries()]
    .map(([raw, label]) => `WHEN ${quote(raw)} THEN ${quote(label)}`)
    .join(' ')
  return `CASE trim(coalesce(${col(field)}, '')) ${arms} ELSE ${quote(UNKNOWN)} END`
}

// Age and income are ranges rather than a vocabulary, so their boundaries live
// here. Both are half-open on the upper bound and the labels match the stats
// table's exactly, en dash included -- a label that differs by a character
// reads as a disagreement the dual read cannot explain.
const AGE_CASE =
  `CASE WHEN ${col('Age_Int')} IS NULL THEN ${quote(UNKNOWN)}` +
  // Under 18 is Unknown, not 51+. The voter table's floor is 18 today (checked
  // across all 219M rows), so this arm matches nothing -- but without it a
  // pre-registrant or a bad age would fall through the ranges below into the
  // open-ended bucket and inflate 51+ silently, which is the one failure mode
  // here that a reader of the numbers could not spot.
  ` WHEN ${col('Age_Int')} < 18 THEN ${quote(UNKNOWN)}` +
  ` WHEN ${col('Age_Int')} BETWEEN 18 AND 25 THEN '18-25'` +
  ` WHEN ${col('Age_Int')} BETWEEN 26 AND 35 THEN '26-35'` +
  ` WHEN ${col('Age_Int')} BETWEEN 36 AND 50 THEN '36-50'` +
  ` ELSE '51+' END`

const INCOME_BANDS: ReadonlyArray<[number, string]> = [
  [15000, '1k\u201315k'],
  [25000, '15k\u201325k'],
  [35000, '25k\u201335k'],
  [50000, '35k\u201350k'],
  [75000, '50k\u201375k'],
  [100000, '75k\u2013100k'],
  [125000, '100k\u2013125k'],
  [150000, '125k\u2013150k'],
  [175000, '150k\u2013175k'],
  [200000, '175k\u2013200k'],
  [250000, '200k\u2013250k'],
]

const INCOME_CASE =
  `CASE WHEN ${col('Estimated_Income_Amount_Int')} IS NULL THEN ${quote(UNKNOWN)} ` +
  INCOME_BANDS.map(
    ([ceiling, label]) =>
      `WHEN ${col('Estimated_Income_Amount_Int')} < ${ceiling} THEN ${quote(label)}`,
  ).join(' ') +
  ` ELSE '250k+' END`

const STATS_DIMENSIONS: ReadonlyArray<[StatsDimensionKey, string]> = [
  ['age', AGE_CASE],
  ['education', mappedCase('Education_Of_Person', RAW_TO_LABEL.education)],
  [
    'homeowner',
    mappedCase('Homeowner_Probability_Model', RAW_TO_LABEL.homeowner),
  ],
  [
    'presenceOfChildren',
    mappedCase('Presence_Of_Children', RAW_TO_LABEL.presenceOfChildren),
  ],
  ['estimatedIncomeRange', INCOME_CASE],
]

export const TOTAL_DIMENSION = 'TOTAL'

// One statement, one scan. GROUPING SETS emits a row per bucket per dimension
// plus a grand-total row from the empty set, which is where the two totals come
// from -- so five distributions and both totals cost a single pass rather than
// one aggregate per dimension.
export const buildDistrictStatsSql = (district: DbxDistrict): DbxStatement => {
  const bag = createBag()
  const scope = buildScopeSql(bag, {
    district,
    filters: { filters: [], filterValues: {}, filterOperators: {} },
  })
  const projections = STATS_DIMENSIONS.map(
    ([key, expr]) => `${expr} AS ${key}`,
  ).join(', ')
  const dimensionCase = STATS_DIMENSIONS.map(
    ([key]) => `WHEN ${key} IS NOT NULL THEN ${quote(key)}`,
  ).join(' ')
  const labelCoalesce = STATS_DIMENSIONS.map(([key]) => key).join(', ')
  const groupingSets = STATS_DIMENSIONS.map(([key]) => `(${key})`).join(', ')
  const sql =
    `WITH scoped AS (SELECT ${projections},` +
    ` ${col('VoterTelephones_CellPhoneFormatted')} AS cell` +
    ` FROM ${VOTER_TABLE} v ${scope})` +
    ` SELECT CASE ${dimensionCase} ELSE ${quote(TOTAL_DIMENSION)} END AS dimension,` +
    ` coalesce(${labelCoalesce}, ${quote('all')}) AS label,` +
    ` COUNT(*) AS count, COUNT(cell) AS with_cell` +
    ` FROM scoped GROUP BY GROUPING SETS (${groupingSets}, ())`
  return { sql, params: bag.params }
}

// Narrows rather than asserts: the dimension name arrives as a plain string
// from the result rows, and a value the response does not publish is skipped.
const isDimensionKey = (value: string): value is StatsDimensionKey =>
  (STATS_DIMENSION_KEYS as readonly string[]).includes(value)

const percentOf = (count: number, total: number): number =>
  total === 0 ? 0 : Math.round((count / total) * 10000) / 100

// Absence still means "no stats", so a district whose scan returns no voters
// maps to null exactly as a missing mirrored row does. Buckets are ordered by
// descending count so a rendered list is stable across calls.
export const mapDistrictStatsRows = (
  districtId: string,
  rows: Array<Array<string | null>>,
): ComputedDistrictStats | null => {
  let total = 0
  let withCell = 0
  const collected: Record<StatsDimensionKey, DistrictStatsBucket[]> = {
    age: [],
    education: [],
    homeowner: [],
    presenceOfChildren: [],
    estimatedIncomeRange: [],
  }
  const pending: Array<[StatsDimensionKey, string, number]> = []
  for (const [dimension, label, count, cell] of rows) {
    if (dimension === TOTAL_DIMENSION) {
      total = Number(count ?? 0)
      withCell = Number(cell ?? 0)
      continue
    }
    if (!dimension || !isDimensionKey(dimension)) continue
    pending.push([dimension, label ?? '', Number(count ?? 0)])
  }
  if (total === 0) return null
  for (const [dimension, label, count] of pending) {
    collected[dimension].push({
      label,
      count,
      percent: percentOf(count, total),
    })
  }
  for (const buckets of Object.values(collected)) {
    buckets.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  }
  return {
    districtId,
    // The live figures describe the voter rows as they are right now; there is
    // no snapshot to date, unlike the mirrored table's updatedAt.
    updatedAt: new Date(),
    totalConstituents: total,
    totalConstituentsWithCellPhone: withCell,
    buckets: collected,
  }
}
