import {
  VOTESCORE,
  baseSignals,
  modeledIAddon,
  regAddon,
  partisanUnionPredicate,
} from './recommendedListsRules.util'

// Pure Databricks SQL builders for the recommended-lists engine. Each function
// returns an exact SQL string; no client, no I/O. The single source table is the
// win-agents voter mart. District and Haystaq column identifiers are backticked
// and allowlist-validated before interpolation; string literals are single-quote
// escaped — the builders never accept a raw identifier they can't vouch for.
export const WIN_AGENT_VOTERS =
  'goodparty_data_catalog.mart_win_agents.win_agent_voters'

const escapeSql = (value: string): string => value.replace(/'/g, "''")

// List type 1 predicate: the plausible-turnout electorate (VOTESCORE >= s*,
// tie-inclusive). 1=1 when no threshold was computed.
const bandPredicate = (sstar: number | null): string =>
  sstar === null ? '1=1' : `((${VOTESCORE})>=${sstar})`

export const districtFilter = (
  state: string,
  districtType: string,
  districtName: string | null,
  allowedDistrictColumns: ReadonlySet<string>,
): string => {
  let filter = `state_postal_code='${escapeSql(state)}'`
  if (districtType && districtType !== 'State') {
    if (!allowedDistrictColumns.has(districtType)) {
      throw new Error(
        `Unknown district column '${districtType}' — ` +
          'not a win_agent_voters dimension',
      )
    }
    filter += ` AND \`${districtType}\`='${escapeSql(districtName ?? '')}'`
  }
  return filter
}

export const votescoreHistogram = (df: string): string =>
  `SELECT (${VOTESCORE}) s, COUNT(*) n FROM ${WIN_AGENT_VOTERS} ` +
  `WHERE ${df} GROUP BY (${VOTESCORE}) ORDER BY s DESC`

export const subGeoStats = (
  df: string,
  candidateCols: readonly string[],
): string => {
  const cols = candidateCols
    .map(
      (col) =>
        `COUNT(DISTINCT CASE WHEN length(trim(\`${col}\`))>0 ` +
        `THEN \`${col}\` END) \`${col}_distinct\`, ` +
        `AVG(CASE WHEN \`${col}\` IS NOT NULL AND ` +
        `length(trim(\`${col}\`))>0 THEN 1.0 ELSE 0.0 END) \`${col}_coverage\``,
    )
    .join(', ')
  return `SELECT ${cols} FROM ${WIN_AGENT_VOTERS} WHERE ${df}`
}

export const anchorTurfs = (df: string, sub: string, sstar: number): string =>
  `SELECT \`${sub}\` area, COUNT(*) n FROM ${WIN_AGENT_VOTERS} ` +
  `WHERE ${df} AND ((${VOTESCORE})>=${sstar}) AND \`${sub}\` IS NOT NULL ` +
  `AND length(trim(\`${sub}\`))>0 GROUP BY \`${sub}\` ORDER BY n DESC LIMIT 3`

export const issueUniverse = (
  df: string,
  hsColumn: string,
  dir: 'high' | 'low',
  sstar: number | null,
  allowedHsColumns: ReadonlySet<string>,
): string => {
  if (!hsColumn.startsWith('hs_') || !allowedHsColumns.has(hsColumn)) {
    throw new Error(
      `Unknown Haystaq column '${hsColumn}' — ` +
        'not an allowed win_agent_voters hs_ column',
    )
  }
  const value = `CAST(${hsColumn} AS DOUBLE)`
  const high = `${value}>=70`
  const low = `${value}<=30`
  const mid = `${value}>30 AND ${value}<70`
  const sup = dir === 'high' ? high : low
  const opp = dir === 'high' ? low : high
  const band = bandPredicate(sstar)
  return (
    `SELECT COUNT(${value}) active, ` +
    `SUM(CASE WHEN ${sup} THEN 1 ELSE 0 END) supporters, ` +
    `SUM(CASE WHEN ${opp} THEN 1 ELSE 0 END) opponents, ` +
    `SUM(CASE WHEN ${mid} THEN 1 ELSE 0 END) persuadable, ` +
    `SUM(CASE WHEN ${sup} AND ${band} THEN 1 ELSE 0 END) ` +
    `supportersPlausible ` +
    `FROM ${WIN_AGENT_VOTERS} WHERE ${df} AND ${hsColumn} IS NOT NULL`
  )
}

export const partisanAggregate = (
  df: string,
  hasDemOpponent: boolean,
  hasGopOpponent: boolean,
  sstar: number | null,
): string => {
  const band = bandPredicate(sstar)
  const universe = partisanUnionPredicate(hasDemOpponent, hasGopOpponent)
  const plausible = `${universe} AND ${band}`
  const sig = baseSignals()
  const signalCols: Array<[string, string]> = [
    ['switch', sig.switch],
    ['ticket', sig.ticket],
    ['priblt', sig.priblt],
    ['dislike', sig.dislike],
    ['modeledI', modeledIAddon(hasDemOpponent, hasGopOpponent)],
  ]
  const reg = regAddon(hasDemOpponent, hasGopOpponent)
  if (reg) signalCols.push(['reg', reg])
  const sums = signalCols
    .map(
      ([alias, pred]) =>
        `SUM(CASE WHEN ${pred} AND ${band} THEN 1 ELSE 0 END) \`${alias}\``,
    )
    .join(', ')
  return (
    'SELECT COUNT(*) tot, ' +
    `SUM(CASE WHEN ${band} THEN 1 ELSE 0 END) list1, ` +
    `SUM(CASE WHEN ${universe} THEN 1 ELSE 0 END) uni, ` +
    `SUM(CASE WHEN ${plausible} THEN 1 ELSE 0 END) listn, ` +
    `${sums} FROM ${WIN_AGENT_VOTERS} WHERE ${df}`
  )
}

export const partisanTurfs = (
  df: string,
  sub: string,
  sstar: number | null,
  unionPredicate: string,
): string => {
  const band = bandPredicate(sstar)
  return (
    `SELECT \`${sub}\` area, COUNT(*) n FROM ${WIN_AGENT_VOTERS} ` +
    `WHERE ${df} AND ${unionPredicate} AND ${band} AND \`${sub}\` IS NOT NULL ` +
    `AND length(trim(\`${sub}\`))>0 GROUP BY \`${sub}\` ORDER BY n DESC LIMIT 3`
  )
}

export const gotvDropoff = (df: string, exponentA: number): string =>
  'SELECT SUM((CAST(hs_likely_mid_term_voter AS DOUBLE)/100.0)*' +
  `POWER(CAST(hs_dropoff_fill_only_top AS DOUBLE)/100.0,${exponentA})) X ` +
  `FROM ${WIN_AGENT_VOTERS} WHERE ${df} ` +
  'AND hs_likely_mid_term_voter IS NOT NULL ' +
  'AND hs_dropoff_fill_only_top IS NOT NULL'
