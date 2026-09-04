import {
  buildScopeSql,
  col,
  createBag,
  VOTER_TABLE,
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
    ` FROM ${VOTER_TABLE} v ${scope}` +
    ` AND ${precinct} IS NOT NULL AND length(trim(${precinct})) > 0` +
    ` GROUP BY ${county}, ${precinct}` +
    ` ORDER BY voters DESC` +
    ` LIMIT ${bag.bind(DOOR_PRECINCT_COUNT, 'INT')}`
  return { sql, params: bag.params }
}
