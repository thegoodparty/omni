import { describe, it, expect } from 'vitest'
import {
  VOTESCORE,
  DOOR_RATIO_FALLBACK,
  DOORS_PER_HOUR,
  THIRD_CUT,
  DISLIKE_CUT,
  CELL_SIZE_FLOOR,
  electionCode,
  officeR,
  exponentA,
  votescoreThreshold,
  pickSubGeo,
  subGeoLabel,
  baseSignals,
  modeledIAddon,
  regAddon,
  partisanUnionPredicate,
  cardSubtitle,
  targetParties,
} from './recommendedListsRules.util'

const utc = (s: string) => new Date(`${s}T00:00:00Z`)

describe('constants', () => {
  it('exposes the documented placeholder VOTESCORE turnout expression', () => {
    expect(VOTESCORE).toBe(
      '(CASE WHEN General_2024 THEN 5 ELSE 0 END)+' +
        '(CASE WHEN General_2022 THEN 4 ELSE 0 END)+' +
        '(CASE WHEN General_2020 THEN 3 ELSE 0 END)+' +
        '(CASE WHEN General_2018 THEN 2 ELSE 0 END)+' +
        '(CASE WHEN General_2016 THEN 1 ELSE 0 END)',
    )
  })

  it('pins the engine tuning constants', () => {
    expect(DOOR_RATIO_FALLBACK).toBe(0.62)
    expect(DOORS_PER_HOUR).toBe(15)
    expect(THIRD_CUT).toBe(50)
    expect(DISLIKE_CUT).toBe(70)
    expect(CELL_SIZE_FLOOR).toBe(50)
  })
})

describe('electionCode', () => {
  it('classifies an even-year November general-election day as General', () => {
    expect(electionCode(utc('2026-11-03'))).toBe('General')
    expect(electionCode(utc('2024-11-05'))).toBe('General')
  })

  it('classifies every odd-year November general-day as LocalOrMunicipal', () => {
    // Serving moved the odd-November states off the retired consolidated
    // category and onto the live local model, so the metadata follows: the
    // state no longer changes the answer.
    expect(electionCode(utc('2025-11-04'))).toBe('LocalOrMunicipal')
    expect(electionCode(utc('2027-11-02'))).toBe('LocalOrMunicipal')
    expect(electionCode(utc('2025-11-04'))).toBe('LocalOrMunicipal')
  })

  it('classifies off-cycle dates as LocalOrMunicipal', () => {
    expect(electionCode(utc('2026-06-15'))).toBe('LocalOrMunicipal')
    expect(electionCode(utc('2027-11-09'))).toBe('LocalOrMunicipal')
    expect(electionCode(null)).toBe('LocalOrMunicipal')
  })
})

describe('officeR', () => {
  it('returns null for federal and for state-wide state offices', () => {
    expect(officeR('FEDERAL', 'Congressional_District', true)).toBeNull()
    expect(officeR('STATE', 'State', false)).toBeNull()
  })

  it('returns 0.07 for a state office in a sub-state district', () => {
    expect(officeR('STATE', 'State_House_District', false)).toBe(0.07)
  })

  it('returns 0.12/0.15 for county offices by partisanship', () => {
    expect(officeR('COUNTY', 'County_Commissioner_District', true)).toBe(0.12)
    expect(officeR('COUNTY', 'County_Commissioner_District', false)).toBe(0.15)
    expect(officeR('county', 'County_Commissioner_District', null)).toBe(0.15)
  })

  it('returns 0.15/0.22 for city/local/township/regional offices', () => {
    expect(officeR('CITY', 'City_Council', true)).toBe(0.15)
    expect(officeR('LOCAL', 'City_Council', false)).toBe(0.22)
    expect(officeR('TOWNSHIP', 'Township', null)).toBe(0.22)
    expect(officeR('REGIONAL', 'Regional', true)).toBe(0.15)
  })

  it('returns null for an unknown position level', () => {
    expect(officeR('SPECIAL', 'Whatever', true)).toBeNull()
    expect(officeR(null, 'Whatever', true)).toBeNull()
  })
})

describe('exponentA', () => {
  it('computes 1/R - 1', () => {
    expect(exponentA(0.5)).toBe(1)
    expect(exponentA(0.2)).toBe(4)
    expect(exponentA(0.25)).toBe(3)
  })

  it('returns null when R is null', () => {
    expect(exponentA(null)).toBeNull()
  })
})

describe('votescoreThreshold', () => {
  const hist = [
    { score: 5, n: 10 },
    { score: 4, n: 20 },
    { score: 3, n: 50 },
  ]

  it('returns the score band where the cumulative count first reaches N', () => {
    expect(votescoreThreshold(hist, 25)).toBe(4)
    expect(votescoreThreshold(hist, 10)).toBe(5)
    expect(votescoreThreshold(hist, 5)).toBe(5)
  })

  it('walks descending even when the histogram is unsorted', () => {
    const unsorted = [
      { score: 3, n: 50 },
      { score: 5, n: 10 },
      { score: 4, n: 20 },
    ]
    expect(votescoreThreshold(unsorted, 25)).toBe(4)
  })

  it('returns the lowest score present when N exceeds the total', () => {
    expect(votescoreThreshold(hist, 200)).toBe(3)
  })

  it('returns null when N is null or zero', () => {
    expect(votescoreThreshold(hist, null)).toBeNull()
    expect(votescoreThreshold(hist, 0)).toBeNull()
  })

  it('returns 0 for an empty histogram with a positive N', () => {
    expect(votescoreThreshold([], 5)).toBe(0)
  })
})

describe('pickSubGeo', () => {
  it('picks the coarsest well-populated sub-geo (County first)', () => {
    expect(
      pickSubGeo(
        [
          { col: 'County', distinct: 5, coverage: 0.9 },
          { col: 'City', distinct: 30, coverage: 0.95 },
          { col: 'Precinct', distinct: 200, coverage: 0.99 },
        ],
        'County_Commissioner_District',
      ),
    ).toBe('County')
  })

  it('skips a candidate that fails distinct or coverage', () => {
    expect(
      pickSubGeo(
        [
          { col: 'County', distinct: 2, coverage: 0.9 },
          { col: 'City', distinct: 30, coverage: 0.8 },
          { col: 'Precinct', distinct: 200, coverage: 0.99 },
        ],
        'County_Commissioner_District',
      ),
    ).toBe('City')
    expect(
      pickSubGeo(
        [
          { col: 'County', distinct: 5, coverage: 0.3 },
          { col: 'City', distinct: 30, coverage: 0.4 },
          { col: 'Precinct', distinct: 200, coverage: 0.99 },
        ],
        'County_Commissioner_District',
      ),
    ).toBe('Precinct')
  })

  it('excludes the districtType column from candidates', () => {
    expect(
      pickSubGeo(
        [
          { col: 'City', distinct: 30, coverage: 0.95 },
          { col: 'Precinct', distinct: 200, coverage: 0.99 },
        ],
        'County',
      ),
    ).toBe('City')
  })

  it('falls back to the finest candidate when none qualify', () => {
    expect(
      pickSubGeo(
        [
          { col: 'County', distinct: 1, coverage: 0.1 },
          { col: 'City', distinct: 1, coverage: 0.1 },
          { col: 'Precinct', distinct: 1, coverage: 0.1 },
        ],
        'County_Commissioner_District',
      ),
    ).toBe('Precinct')
  })
})

describe('subGeoLabel', () => {
  it('maps sub-geo columns to candidate-facing plurals', () => {
    expect(subGeoLabel('County')).toBe('counties')
    expect(subGeoLabel('City')).toBe('municipalities')
    expect(subGeoLabel('Precinct')).toBe('precincts')
    expect(subGeoLabel('City_Ward')).toBe('wards')
  })
})

describe('baseSignals', () => {
  it('emits the exact 2b union predicate fragments', () => {
    expect(baseSignals()).toEqual({
      switch:
        "VoterParties_Change_Changed_Party IN ('Within Last 1 Year'," +
        "'Between 1 and 2 Years Ago','Between 2 and 4 Years Ago')",
      ticket: "hf_ticket_splitter = 'Ticket Splitter Often'",
      priblt:
        "(PRI_BLT_2020='O' OR PRI_BLT_2022='O' OR PRI_BLT_2024='O' OR " +
        "((PRI_BLT_2020='D' OR PRI_BLT_2022='D' OR PRI_BLT_2024='D') AND " +
        "(PRI_BLT_2020='R' OR PRI_BLT_2022='R' OR PRI_BLT_2024='R')))",
      dislike: 'hs_trump_vs_harris_double_dislike >= 70',
    })
  })
})

describe('modeledIAddon', () => {
  it('is the bare third-party support cut for a nonpartisan race', () => {
    expect(modeledIAddon(false, false)).toBe(
      '(hs_partisanship_moderate_third_party_support >= 50)',
    )
  })

  it('subtracts strong opponent-party partisans when facing a Democrat', () => {
    expect(modeledIAddon(true, false)).toBe(
      '(hs_partisanship_moderate_third_party_support >= 50 AND ' +
        '(COALESCE(hs_ideology_partisanship_partisanship_overall_party_dem,0)' +
        ' < 70))',
    )
  })

  it('subtracts both opponent parties in a two-sided race', () => {
    expect(modeledIAddon(true, true)).toBe(
      '(hs_partisanship_moderate_third_party_support >= 50 AND ' +
        '(COALESCE(hs_ideology_partisanship_partisanship_overall_party_dem,0)' +
        ' < 70) AND ' +
        '(COALESCE(hs_ideology_partisanship_partisanship_overall_party_gop,0)' +
        ' < 70))',
    )
  })
})

describe('regAddon', () => {
  it('adds registrants not in the opponent party (one-sided)', () => {
    expect(regAddon(true, false)).toBe("Parties_Description <> 'Democratic'")
    expect(regAddon(false, true)).toBe("Parties_Description <> 'Republican'")
  })

  it('adds only Independents in a two-sided race', () => {
    expect(regAddon(true, true)).toBe(
      "Parties_Description NOT IN ('Democratic','Republican')",
    )
  })

  it('is null for a nonpartisan race', () => {
    expect(regAddon(false, false)).toBeNull()
  })
})

describe('partisanUnionPredicate', () => {
  it('unions the base signals with modeled-I only for a nonpartisan race', () => {
    expect(partisanUnionPredicate(false, false)).toBe(
      "(((VoterParties_Change_Changed_Party IN ('Within Last 1 Year'," +
        "'Between 1 and 2 Years Ago','Between 2 and 4 Years Ago')) OR " +
        "(hf_ticket_splitter = 'Ticket Splitter Often') OR " +
        "((PRI_BLT_2020='O' OR PRI_BLT_2022='O' OR PRI_BLT_2024='O' OR " +
        "((PRI_BLT_2020='D' OR PRI_BLT_2022='D' OR PRI_BLT_2024='D') AND " +
        "(PRI_BLT_2020='R' OR PRI_BLT_2022='R' OR PRI_BLT_2024='R')))) OR " +
        '(hs_trump_vs_harris_double_dislike >= 70)) OR ' +
        '(hs_partisanship_moderate_third_party_support >= 50))',
    )
  })

  it('adds the registration add-on for a one-sided partisan race', () => {
    expect(partisanUnionPredicate(true, false)).toBe(
      "(((VoterParties_Change_Changed_Party IN ('Within Last 1 Year'," +
        "'Between 1 and 2 Years Ago','Between 2 and 4 Years Ago')) OR " +
        "(hf_ticket_splitter = 'Ticket Splitter Often') OR " +
        "((PRI_BLT_2020='O' OR PRI_BLT_2022='O' OR PRI_BLT_2024='O' OR " +
        "((PRI_BLT_2020='D' OR PRI_BLT_2022='D' OR PRI_BLT_2024='D') AND " +
        "(PRI_BLT_2020='R' OR PRI_BLT_2022='R' OR PRI_BLT_2024='R')))) OR " +
        '(hs_trump_vs_harris_double_dislike >= 70)) OR ' +
        '(hs_partisanship_moderate_third_party_support >= 50 AND ' +
        '(COALESCE(hs_ideology_partisanship_partisanship_overall_party_dem,0)' +
        " < 70)) OR Parties_Description <> 'Democratic')",
    )
  })
})

describe('cardSubtitle', () => {
  const tail =
    'voters showing signs of independence — party-switchers, ' +
    'ticket-splitters, cross-party primary voters, and those who dislike ' +
    'both major parties.'

  it('has no registration clause for a nonpartisan race', () => {
    expect(cardSubtitle(false, false)).toBe(
      `Moderate-to-high propensity ${tail}`,
    )
  })

  it('names the target registration group by opponent field', () => {
    expect(cardSubtitle(true, true)).toBe(
      `Moderate-to-high propensity voters who are registered Independents, ` +
        `and ${tail}`,
    )
    expect(cardSubtitle(true, false)).toBe(
      `Moderate-to-high propensity voters who are registered Independents ` +
        `or Republicans, and ${tail}`,
    )
    expect(cardSubtitle(false, true)).toBe(
      `Moderate-to-high propensity voters who are registered Independents ` +
        `or Democrats, and ${tail}`,
    )
  })
})

describe('targetParties', () => {
  it('names the non-opponent parties for a one-sided partisan race', () => {
    expect(targetParties(true, true, false)).toBe(
      'Republicans and Independents',
    )
    expect(targetParties(true, false, true)).toBe('Democrats and Independents')
  })

  it('is null for a nonpartisan race or a two-sided race', () => {
    expect(targetParties(false, true, false)).toBeNull()
    expect(targetParties(true, true, true)).toBeNull()
    expect(targetParties(true, false, false)).toBeNull()
  })
})
