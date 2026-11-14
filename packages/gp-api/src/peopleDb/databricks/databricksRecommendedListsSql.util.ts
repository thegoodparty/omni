import type { IdOverrides } from '@goodparty_org/contracts'
import type { AffinityColumn } from '../affinityColumns.const'
import type { FilterData } from '../schemas/filters.schema'
import {
  affinityColumnForDataset,
  buildScopeSql,
  buildVoterFiltersSql,
  col,
  createBag,
  type DbxDistrict,
  type DbxScopeArgs,
  type DbxStatement,
} from './databricksVoterSql.util'

// How many precincts a door-knocking recommendation covers. Fixed, and
// fixed at three because our precincts are typically small enough that
// three of them is a reasonable walk list -- which is also what the source
// model has always said (Nigel's `anchorTurfs()` ranks by voter count
// descending and takes the top 3).
export const DOOR_PRECINCT_COUNT = 3

// One variant's matching voters, ranked by precinct for door-knocking
// targeting, cut to the top DOOR_PRECINCT_COUNT. Voters with no precinct on
// file are excluded rather than grouped: they otherwise collapse into a
// single synthetic county-level bucket (Precinct IS NULL) that has run as
// high as 17,140 voters in one sampled district and would rank like a real
// precinct, pointing a canvasser at no geography at all. Ranked by plain
// voter count, descending -- not density -- per the door-knocking precinct
// selection decision.
export const buildRankPrecinctsSql = (args: DbxScopeArgs): DbxStatement => {
  const bag = createBag()
  const scope = buildScopeSql(bag, args)
  const county = col('County')
  const precinct = col('Precinct')
  const sql =
    `SELECT ${county} AS county, ${precinct} AS precinct,` +
    ` COUNT(*) AS voters` +
    ` FROM ${args.district.table} v ${scope}` +
    ` AND ${precinct} IS NOT NULL AND length(trim(${precinct})) > 0` +
    ` GROUP BY ${county}, ${precinct}` +
    ` ORDER BY voters DESC` +
    ` LIMIT ${bag.bind(DOOR_PRECINCT_COUNT, 'INT')}`
  return { sql, params: bag.params }
}

export type RecommendedListCountScope = {
  filters: FilterData
  idOverrides?: IdOverrides
  affinityColumn?: AffinityColumn
}

// Nothing to AND onto the district scope below: each variant's own predicates
// are COUNT_IF arguments, not WHERE clauses.
const NO_FILTERS: FilterData = {
  filters: [],
  filterValues: {},
  filterOperators: {},
}

// Every variant's count from ONE scan of the district. A request sizes as many
// as thirteen variants, and one statement per variant put that many concurrent
// aggregates on a four-cluster serverless warehouse per page view -- the same
// fan-out buildListDetailAggregatesSql was built to remove for the reachability
// tiles. Sharing the scan costs the variants their independence: a failed
// statement now fails every counted variant rather than one card, which is the
// price of not asking the warehouse the same question thirteen times.
//
// COUNT_IF keeps each predicate in the aggregate instead of the WHERE, so no
// predicate can skip files; the scan is the district either way, which is what
// a district-wide count reads regardless.
export const buildRecommendedListCountsSql = (args: {
  district: DbxDistrict
  variants: ReadonlyArray<RecommendedListCountScope>
}): DbxStatement => {
  const bag = createBag()
  const scope = buildScopeSql(bag, {
    district: args.district,
    filters: NO_FILTERS,
  })
  const hasOverlay = args.district.dataset.overlayOrgSlug !== undefined
  const columns = args.variants.map((variant, index) => {
    const clause = buildVoterFiltersSql(
      bag,
      variant.filters,
      variant.idOverrides,
      undefined,
      affinityColumnForDataset({ district: args.district, ...variant }),
      hasOverlay,
    )
    return `COUNT_IF(${clause ?? 'TRUE'}) AS count_${index}`
  })
  const sql =
    `SELECT ${columns.join(', ')}` + ` FROM ${args.district.table} v ${scope}`
  return { sql, params: bag.params }
}
