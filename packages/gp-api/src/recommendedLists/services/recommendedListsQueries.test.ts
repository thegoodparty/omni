import { describe, it, expect } from 'vitest'
import {
  VOTESCORE,
  baseSignals,
  modeledIAddon,
  regAddon,
  partisanUnionPredicate,
} from './recommendedListsRules.util'
import {
  WIN_AGENT_VOTERS,
  districtFilter,
  votescoreHistogram,
  subGeoStats,
  anchorTurfs,
  issueUniverse,
  partisanAggregate,
  partisanTurfs,
  gotvDropoff,
} from './recommendedListsQueries'

const TABLE = WIN_AGENT_VOTERS
const allowed = new Set([
  'County_Commissioner_District',
  'County',
  'City',
  'Precinct',
])
const allowedHs = new Set(['hs_environment_score'])

// gabriela-kroetch parity fixture (MN county-commissioner race).
const DF = districtFilter(
  'MN',
  'County_Commissioner_District',
  'SCOTT CNTY COMM DIST 5',
  allowed,
)

describe('districtFilter', () => {
  it('builds a state + backticked district predicate', () => {
    expect(DF).toBe(
      "state_postal_code='MN' AND " +
        "`County_Commissioner_District`='SCOTT CNTY COMM DIST 5'",
    )
  })

  it('emits only the state predicate for a state-wide district', () => {
    expect(districtFilter('MN', 'State', null, allowed)).toBe(
      "state_postal_code='MN'",
    )
  })

  it('single-quote-escapes the district name and state', () => {
    expect(
      districtFilter('MN', 'County_Commissioner_District', "O'BRIEN", allowed),
    ).toBe(
      "state_postal_code='MN' AND `County_Commissioner_District`='O''BRIEN'",
    )
  })

  it('throws on a district column not in the allowlist', () => {
    expect(() =>
      districtFilter('MN', 'Evil_Col; DROP TABLE', 'x', allowed),
    ).toThrow()
  })
})

describe('votescoreHistogram', () => {
  it('groups the VOTESCORE band counts descending', () => {
    expect(votescoreHistogram(DF)).toBe(
      `SELECT (${VOTESCORE}) s, COUNT(*) n FROM ${TABLE} ` +
        `WHERE ${DF} GROUP BY (${VOTESCORE}) ORDER BY s DESC`,
    )
  })
})

describe('subGeoStats', () => {
  it('measures distinct + coverage for every candidate column in one query', () => {
    expect(subGeoStats(DF, ['County', 'City'])).toBe(
      'SELECT COUNT(DISTINCT CASE WHEN length(trim(`County`))>0 ' +
        'THEN `County` END) `County_distinct`, ' +
        'AVG(CASE WHEN `County` IS NOT NULL AND ' +
        'length(trim(`County`))>0 THEN 1.0 ELSE 0.0 END) `County_coverage`, ' +
        'COUNT(DISTINCT CASE WHEN length(trim(`City`))>0 ' +
        'THEN `City` END) `City_distinct`, ' +
        'AVG(CASE WHEN `City` IS NOT NULL AND ' +
        'length(trim(`City`))>0 THEN 1.0 ELSE 0.0 END) `City_coverage` ' +
        `FROM ${TABLE} WHERE ${DF}`,
    )
  })
})

describe('anchorTurfs', () => {
  it('counts the plausible-turnout band grouped by sub-geo, top 3', () => {
    expect(anchorTurfs(DF, 'City', 3)).toBe(
      `SELECT \`City\` area, COUNT(*) n FROM ${TABLE} ` +
        `WHERE ${DF} AND ((${VOTESCORE})>=3) AND \`City\` IS NOT NULL ` +
        'AND length(trim(`City`))>0 GROUP BY `City` ORDER BY n DESC LIMIT 3',
    )
  })
})

describe('issueUniverse', () => {
  it('sizes the district issue universe with dir=high poles', () => {
    const v = 'CAST(hs_environment_score AS DOUBLE)'
    expect(
      issueUniverse(DF, 'hs_environment_score', 'high', 3, allowedHs),
    ).toBe(
      `SELECT COUNT(${v}) active, ` +
        `SUM(CASE WHEN ${v}>=70 THEN 1 ELSE 0 END) supporters, ` +
        `SUM(CASE WHEN ${v}<=30 THEN 1 ELSE 0 END) opponents, ` +
        `SUM(CASE WHEN ${v}>30 AND ${v}<70 THEN 1 ELSE 0 END) persuadable, ` +
        `SUM(CASE WHEN ${v}>=70 AND ((${VOTESCORE})>=3) THEN 1 ELSE 0 END) ` +
        `supportersPlausible ` +
        `FROM ${TABLE} WHERE ${DF} AND hs_environment_score IS NOT NULL`,
    )
  })

  it('inverts the poles for dir=low (candidate sits with low scorers)', () => {
    const v = 'CAST(hs_environment_score AS DOUBLE)'
    expect(issueUniverse(DF, 'hs_environment_score', 'low', 3, allowedHs)).toBe(
      `SELECT COUNT(${v}) active, ` +
        `SUM(CASE WHEN ${v}<=30 THEN 1 ELSE 0 END) supporters, ` +
        `SUM(CASE WHEN ${v}>=70 THEN 1 ELSE 0 END) opponents, ` +
        `SUM(CASE WHEN ${v}>30 AND ${v}<70 THEN 1 ELSE 0 END) persuadable, ` +
        `SUM(CASE WHEN ${v}<=30 AND ((${VOTESCORE})>=3) THEN 1 ELSE 0 END) ` +
        `supportersPlausible ` +
        `FROM ${TABLE} WHERE ${DF} AND hs_environment_score IS NOT NULL`,
    )
  })

  it('uses a 1=1 band when there is no turnout threshold', () => {
    const v = 'CAST(hs_environment_score AS DOUBLE)'
    expect(
      issueUniverse(DF, 'hs_environment_score', 'high', null, allowedHs),
    ).toContain(`SUM(CASE WHEN ${v}>=70 AND 1=1 THEN 1 ELSE 0 END)`)
  })

  it('throws on a non-hs_ column or one outside the allowlist', () => {
    expect(() => issueUniverse(DF, 'evil_col', 'high', 3, allowedHs)).toThrow()
    expect(() =>
      issueUniverse(DF, 'hs_not_allowed', 'high', 3, allowedHs),
    ).toThrow()
  })
})

describe('partisanAggregate', () => {
  it('counts each 2b signal intersected with the plausible band (one-sided)', () => {
    const band = `((${VOTESCORE})>=3)`
    const universe = partisanUnionPredicate(true, false)
    const sig = baseSignals()
    const mi = modeledIAddon(true, false)
    const reg = regAddon(true, false)
    expect(partisanAggregate(DF, true, false, 3)).toBe(
      'SELECT COUNT(*) tot, ' +
        `SUM(CASE WHEN ${band} THEN 1 ELSE 0 END) list1, ` +
        `SUM(CASE WHEN ${universe} THEN 1 ELSE 0 END) uni, ` +
        `SUM(CASE WHEN ${universe} AND ${band} THEN 1 ELSE 0 END) listn, ` +
        `SUM(CASE WHEN ${sig.switch} AND ${band} THEN 1 ELSE 0 END) \`switch\`, ` +
        `SUM(CASE WHEN ${sig.ticket} AND ${band} THEN 1 ELSE 0 END) \`ticket\`, ` +
        `SUM(CASE WHEN ${sig.priblt} AND ${band} THEN 1 ELSE 0 END) \`priblt\`, ` +
        `SUM(CASE WHEN ${sig.dislike} AND ${band} THEN 1 ELSE 0 END) \`dislike\`, ` +
        `SUM(CASE WHEN ${mi} AND ${band} THEN 1 ELSE 0 END) \`modeledI\`, ` +
        `SUM(CASE WHEN ${reg} AND ${band} THEN 1 ELSE 0 END) \`reg\` ` +
        `FROM ${TABLE} WHERE ${DF}`,
    )
  })

  it('omits the reg column and uses a 1=1 band for a nonpartisan race', () => {
    const universe = partisanUnionPredicate(false, false)
    const sig = baseSignals()
    const mi = modeledIAddon(false, false)
    expect(partisanAggregate(DF, false, false, null)).toBe(
      'SELECT COUNT(*) tot, ' +
        'SUM(CASE WHEN 1=1 THEN 1 ELSE 0 END) list1, ' +
        `SUM(CASE WHEN ${universe} THEN 1 ELSE 0 END) uni, ` +
        `SUM(CASE WHEN ${universe} AND 1=1 THEN 1 ELSE 0 END) listn, ` +
        `SUM(CASE WHEN ${sig.switch} AND 1=1 THEN 1 ELSE 0 END) \`switch\`, ` +
        `SUM(CASE WHEN ${sig.ticket} AND 1=1 THEN 1 ELSE 0 END) \`ticket\`, ` +
        `SUM(CASE WHEN ${sig.priblt} AND 1=1 THEN 1 ELSE 0 END) \`priblt\`, ` +
        `SUM(CASE WHEN ${sig.dislike} AND 1=1 THEN 1 ELSE 0 END) \`dislike\`, ` +
        `SUM(CASE WHEN ${mi} AND 1=1 THEN 1 ELSE 0 END) \`modeledI\` ` +
        `FROM ${TABLE} WHERE ${DF}`,
    )
  })
})

describe('partisanTurfs', () => {
  it('groups the persuasion universe band by sub-geo, top 3', () => {
    expect(partisanTurfs(DF, 'City', 3, '(U)')).toBe(
      `SELECT \`City\` area, COUNT(*) n FROM ${TABLE} ` +
        `WHERE ${DF} AND (U) AND ((${VOTESCORE})>=3) AND \`City\` IS NOT NULL ` +
        'AND length(trim(`City`))>0 GROUP BY `City` ORDER BY n DESC LIMIT 3',
    )
  })
})

describe('gotvDropoff', () => {
  it('sums the modeled drop-off fill weighted by the office exponent', () => {
    expect(gotvDropoff(DF, 1.5)).toBe(
      'SELECT SUM((CAST(hs_likely_mid_term_voter AS DOUBLE)/100.0)*' +
        'POWER(CAST(hs_dropoff_fill_only_top AS DOUBLE)/100.0,1.5)) X ' +
        `FROM ${TABLE} WHERE ${DF} ` +
        'AND hs_likely_mid_term_voter IS NOT NULL ' +
        'AND hs_dropoff_fill_only_top IS NOT NULL',
    )
  })
})
