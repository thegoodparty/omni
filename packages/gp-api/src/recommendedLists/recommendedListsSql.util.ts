import {
  buildScopeSql,
  col,
  createBag,
  VOTER_TABLE,
  type DbxScopeArgs,
  type DbxStatement,
} from '../peopleDb/databricks/databricksVoterSql.util'

// Bounds the ranked-precinct result at the DB layer. California statewide has
// 50,041 precincts (docs/features/recommended-lists.md) against a door target
// of 5,000-15,000 voters that the top handful of precincts always covers, so
// an unbounded GROUP BY would return two orders of magnitude more rows than
// any door-knocking recommendation could ever use.
export const MAX_RANKED_PRECINCTS = 500

export type RankPrecinctsArgs = DbxScopeArgs & { limit: number }

// One variant's matching voters, ranked by precinct for door-knocking
// targeting. Voters with no precinct on file are excluded rather than
// grouped: they otherwise collapse into a single synthetic county-level
// bucket (Precinct IS NULL) that has run as high as 17,140 voters in one
// sampled district and would rank like a real precinct, pointing a canvasser
// at no geography at all. Ranked by plain voter count, descending -- not
// density -- per the door-knocking precinct selection decision.
export const buildRankPrecinctsSql = (
  args: RankPrecinctsArgs,
): DbxStatement => {
  const bag = createBag()
  const scope = buildScopeSql(bag, args)
  const county = col('County')
  const precinct = col('Precinct')
  const sql =
    `SELECT ${county} AS county, ${precinct} AS precinct,` +
    ` COUNT(*) AS voters` +
    ` FROM ${VOTER_TABLE} v ${scope}` +
    ` AND ${precinct} IS NOT NULL AND length(trim(${precinct})) > 0` +
    ` GROUP BY ${county}, ${precinct}` +
    ` ORDER BY voters DESC` +
    ` LIMIT ${bag.bind(args.limit, 'INT')}`
  return { sql, params: bag.params }
}
