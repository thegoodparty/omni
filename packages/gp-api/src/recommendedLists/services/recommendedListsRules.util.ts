import type {
  RecommendedListElectionCode,
  RecommendedListSubGeoLabel,
} from '@goodparty_org/contracts'

// Ported verbatim from the deterministic recommended-lists engine
// (gp-recommended-lists/scripts/recommended_lists_engine.py). Every rule here
// mirrors that spec; the SQL fragment strings are the exact predicates the
// engine emits so query builders and parity checks stay byte-identical.

// Documented placeholder for the per-voter turnout probability p_hat: the
// precinct-of-1 form of the LightGBM precinct model, expressed as a weighted
// count of recent general-election participation. Callers filter on
// `VOTESCORE >= s*` to define the plausible-turnout electorate (List type 1).
export const VOTESCORE =
  '(CASE WHEN General_2024 THEN 5 ELSE 0 END)+' +
  '(CASE WHEN General_2022 THEN 4 ELSE 0 END)+' +
  '(CASE WHEN General_2020 THEN 3 ELSE 0 END)+' +
  '(CASE WHEN General_2018 THEN 2 ELSE 0 END)+' +
  '(CASE WHEN General_2016 THEN 1 ELSE 0 END)'

// The win mart lacks street addresses, so household density can't be computed
// live. TODO: source a real distinct-household count from people-api.
export const DOOR_RATIO_FALLBACK = 0.62
export const DOORS_PER_HOUR = 15
export const THIRD_CUT = 50
export const DISLIKE_CUT = 70
export const CELL_SIZE_FLOOR = 50

// Strong opponent-party partisan threshold. Distinct from DISLIKE_CUT: a voter
// modeled at/above this on a running opponent's party model is dropped from the
// modeled-independent add-on.
const OPPONENT_PARTY_CUT = 70
const DEM_COL = 'hs_ideology_partisanship_partisanship_overall_party_dem'
const GOP_COL = 'hs_ideology_partisanship_partisanship_overall_party_gop'

const CONSOLIDATED_ODD_YEAR_STATES = ['LA', 'MS', 'NJ', 'VA']

export const electionCode = (
  date: Date | null,
  state: string,
): RecommendedListElectionCode => {
  // Read the calendar date in UTC so classification matches the engine's
  // timezone-naive `date` semantics and never drifts with the server's zone.
  if (
    date &&
    date.getUTCMonth() === 10 &&
    date.getUTCDay() === 2 &&
    date.getUTCDate() > 1 &&
    date.getUTCDate() <= 8
  ) {
    const year = date.getUTCFullYear()
    if (year % 2 === 0) return 'General'
    if (CONSOLIDATED_ODD_YEAR_STATES.includes(state)) {
      return 'ConsolidatedGeneral'
    }
    if (state === 'KS' && (year - 2003) % 4 === 0) {
      return 'ConsolidatedGeneral'
    }
    return 'LocalOrMunicipal'
  }
  return 'LocalOrMunicipal'
}

const CITY_LEVEL_R_LEVELS = ['CITY', 'LOCAL', 'TOWNSHIP', 'REGIONAL']

export const officeR = (
  positionLevel: string | null,
  districtType: string,
  isPartisan: boolean | null,
): number | null => {
  const pl = (positionLevel ?? '').toUpperCase()
  if (pl === 'FEDERAL') return null
  if (pl === 'STATE') return districtType === 'State' ? null : 0.07
  if (pl === 'COUNTY') return isPartisan === true ? 0.12 : 0.15
  if (CITY_LEVEL_R_LEVELS.includes(pl)) {
    return isPartisan === true ? 0.15 : 0.22
  }
  return null
}

export const exponentA = (r: number | null): number | null =>
  r ? 1 / r - 1 : null

export const votescoreThreshold = (
  histogram: Array<{ score: number; n: number }>,
  targetN: number | null,
): number | null => {
  if (!targetN) return null
  const rows = [...histogram].sort((a, b) => b.score - a.score)
  let cum = 0
  for (const row of rows) {
    cum += row.n
    // Return the whole boundary band (VOTESCORE >= this score), never trimming
    // tied voters to hit an exact N — band count >= N by design.
    if (cum >= targetN) return row.score
  }
  return rows.length ? rows[rows.length - 1].score : 0
}

export type SubGeoColumn = 'County' | 'City' | 'Precinct'
const SUB_GEO_CANDIDATES: readonly SubGeoColumn[] = [
  'County',
  'City',
  'Precinct',
]

export const pickSubGeo = (
  stats: Array<{ col: SubGeoColumn; distinct: number; coverage: number }>,
  districtType: string,
): SubGeoColumn => {
  const candidates = SUB_GEO_CANDIDATES.filter((c) => c !== districtType)
  for (const col of candidates) {
    const stat = stats.find((s) => s.col === col)
    if (stat && stat.distinct >= 3 && stat.coverage >= 0.5) return col
  }
  return candidates[candidates.length - 1]
}

export const SUB_GEO_LABELS = {
  County: 'counties',
  City: 'municipalities',
  Precinct: 'precincts',
  City_Ward: 'wards',
} as const

export const subGeoLabel = (
  col: keyof typeof SUB_GEO_LABELS,
): RecommendedListSubGeoLabel => SUB_GEO_LABELS[col]

export const baseSignals = (): {
  switch: string
  ticket: string
  priblt: string
  dislike: string
} => ({
  switch:
    "VoterParties_Change_Changed_Party IN ('Within Last 1 Year'," +
    "'Between 1 and 2 Years Ago','Between 2 and 4 Years Ago')",
  ticket: "hf_ticket_splitter = 'Ticket Splitter Often'",
  priblt:
    "(PRI_BLT_2020='O' OR PRI_BLT_2022='O' OR PRI_BLT_2024='O' OR " +
    "((PRI_BLT_2020='D' OR PRI_BLT_2022='D' OR PRI_BLT_2024='D') AND " +
    "(PRI_BLT_2020='R' OR PRI_BLT_2022='R' OR PRI_BLT_2024='R')))",
  dislike: `hs_trump_vs_harris_double_dislike >= ${DISLIKE_CUT}`,
})

export const modeledIAddon = (
  hasDemOpponent: boolean,
  hasGopOpponent: boolean,
): string => {
  const conds = [`hs_partisanship_moderate_third_party_support >= ${THIRD_CUT}`]
  if (hasDemOpponent) {
    conds.push(`(COALESCE(${DEM_COL},0) < ${OPPONENT_PARTY_CUT})`)
  }
  if (hasGopOpponent) {
    conds.push(`(COALESCE(${GOP_COL},0) < ${OPPONENT_PARTY_CUT})`)
  }
  return `(${conds.join(' AND ')})`
}

export const regAddon = (
  hasDemOpponent: boolean,
  hasGopOpponent: boolean,
): string | null => {
  if (hasGopOpponent && !hasDemOpponent) {
    return "Parties_Description <> 'Republican'"
  }
  if (hasDemOpponent && !hasGopOpponent) {
    return "Parties_Description <> 'Democratic'"
  }
  if (hasDemOpponent && hasGopOpponent) {
    return "Parties_Description NOT IN ('Democratic','Republican')"
  }
  return null
}

export const partisanUnionPredicate = (
  hasDemOpponent: boolean,
  hasGopOpponent: boolean,
): string => {
  const sig = baseSignals()
  const union = [sig.switch, sig.ticket, sig.priblt, sig.dislike]
    .map((pred) => `(${pred})`)
    .join(' OR ')
  const parts = [`(${union})`, modeledIAddon(hasDemOpponent, hasGopOpponent)]
  const reg = regAddon(hasDemOpponent, hasGopOpponent)
  if (reg) parts.push(reg)
  return `(${parts.join(' OR ')})`
}

export const cardSubtitle = (
  hasDemOpponent: boolean,
  hasGopOpponent: boolean,
): string => {
  const tail =
    'voters showing signs of independence — party-switchers, ' +
    'ticket-splitters, cross-party primary voters, and those who dislike ' +
    'both major parties.'
  if (!hasDemOpponent && !hasGopOpponent) {
    return `Moderate-to-high propensity ${tail}`
  }
  const reg =
    hasDemOpponent && hasGopOpponent
      ? 'registered Independents'
      : hasDemOpponent
        ? 'registered Independents or Republicans'
        : 'registered Independents or Democrats'
  return `Moderate-to-high propensity voters who are ${reg}, and ${tail}`
}

export const targetParties = (
  isPartisan: boolean,
  hasDemOpponent: boolean,
  hasGopOpponent: boolean,
): string | null => {
  if (!isPartisan) return null
  if (hasDemOpponent && !hasGopOpponent) return 'Republicans and Independents'
  if (hasGopOpponent && !hasDemOpponent) return 'Democrats and Independents'
  return null
}
