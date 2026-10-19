import type {
  AcsCounts,
  RespondentCell,
} from '@/peopleDb/databricks/districtCensusSql.util'
import {
  poolSmallValues,
  rake,
  type RakingCell,
  type RakingResult,
  type RakingTargets,
} from './raking.util'
import { MIN_UNDERREPRESENTED_GAP } from './priorityReadStatus.util'
import { MIN_DISTRICT_SHARE_FOR_RACE_GROUP } from './representation.util'

// A value with fewer answers than this pools with the other small ones, so
// no handful of people carries a whole group's weight.
export const MIN_ANSWERS_PER_WEIGHTING_GROUP = 5
export const POOLED_VALUE = 'other'

const shares = (
  parts: Record<string, number | null>,
): Record<string, number> | null => {
  const entries = Object.entries(parts)
  if (entries.some(([, value]) => value === null || value < 0)) return null
  const total = entries.reduce((sum, [, value]) => sum + (value ?? 0), 0)
  if (total <= 0) return null
  return Object.fromEntries(
    entries.map(([key, value]) => [key, (value ?? 0) / total]),
  )
}

const ageTargets = (district: AcsCounts): Record<string, number> | null => {
  const { totalPopulation, populationUnder18, population65Plus } = district
  if (
    totalPopulation === null ||
    populationUnder18 === null ||
    population65Plus === null
  ) {
    return null
  }
  return shares({
    '18to64': totalPopulation - populationUnder18 - population65Plus,
    '65plus': population65Plus,
  })
}

// Households, not people: the census publishes tenure per household, and a
// respondent's tenure is their household's. A known bias, kept on purpose
// until a statistician weighs in: owner households hold more adults than
// renter ones, so the owner share of households sits below the owner share
// of adults, and holding person answers to it makes renters look less
// heard than they are.
const tenureTargets = (district: AcsCounts): Record<string, number> | null => {
  const { households, ownerOccupiedHouseholds } = district
  if (households === null || ownerOccupiedHouseholds === null) return null
  return shares({
    owner: ownerOccupiedHouseholds,
    renter: households - ownerOccupiedHouseholds,
  })
}

// The census publishes race and Hispanic origin over everyone, not adults,
// so these shares include children; see the decision record
// docs/decisions/2026-10-19-race-ethnicity-in-civic-panel.md. Native
// American joins 'other' because the voter file has no such group, and a
// group under the share the comparison bars hide folds into 'other' too,
// so no handful of people is weighted up to stand for it.
const raceTargets = (district: AcsCounts): Record<string, number> | null => {
  const other =
    district.populationNativeAmericanNh === null ||
    district.populationOtherNh === null
      ? null
      : district.populationNativeAmericanNh + district.populationOtherNh
  const all = shares({
    white: district.populationWhiteNh,
    black: district.populationBlackNh,
    hispanic: district.populationHispanic,
    asian: district.populationAsianNh,
    other,
  })
  if (!all) return null
  const folded: Record<string, number> = {}
  for (const [value, share] of Object.entries(all)) {
    const key = share < MIN_DISTRICT_SHARE_FOR_RACE_GROUP ? POOLED_VALUE : value
    folded[key] = (folded[key] ?? 0) + share
  }
  return folded
}

export interface WeightingCensus {
  district: AcsCounts
  tractAdults: Map<string, number>
  // Adult shares by gender, once the marts publish sex by age.
  genderShares?: { male: number; female: number } | null
}

// The census marginals each answer is weighted to. A dimension the census
// cannot give for this district is left out rather than guessed.
export const weightingTargets = (census: WeightingCensus): RakingTargets => {
  const targets: RakingTargets = {}
  const age = ageTargets(census.district)
  if (age) targets.age = age
  const tenure = tenureTargets(census.district)
  if (tenure) targets.tenure = tenure
  const tract = shares(Object.fromEntries(census.tractAdults))
  if (tract) targets.tract = tract
  const race = raceTargets(census.district)
  if (race) targets.race = race
  if (census.genderShares) {
    const gender = shares(census.genderShares)
    if (gender) targets.gender = gender
  }
  return targets
}

// Race names a group or leans a draw only when enough of the people have a
// known value and few are unknown. Below either, it only weights: the voter
// file's ethnicity is modeled, and its unknowns are not a random slice.
export const MIN_KNOWN_RACE = 10
export const MIN_KNOWN_RACE_SHARE = 0.7

export const raceNameable = (cells: RespondentCell[]): boolean => {
  let total = 0
  let known = 0
  for (const cell of cells) {
    total += cell.count
    if (cell.race !== null) known += cell.count
  }
  return known >= MIN_KNOWN_RACE && known / total >= MIN_KNOWN_RACE_SHARE
}

export const toRakingCells = (cells: RespondentCell[]): RakingCell[] =>
  cells.map((cell) => ({
    count: cell.count,
    values: {
      age: cell.ageBand,
      tenure: cell.tenure,
      tract: cell.tract,
      gender: cell.gender,
      race: cell.race,
    },
  }))

// A respondent living outside every known tract sits out the neighborhood
// dimension, and one in a race group folded into 'other' counts there.
export const placeCells = (
  cells: RakingCell[],
  targets: RakingTargets,
): RakingCell[] =>
  cells.map((cell) => {
    const { tract, race } = cell.values
    const values = { ...cell.values }
    if (tract != null && targets.tract?.[tract] === undefined) {
      values.tract = null
    }
    if (race != null && targets.race && targets.race[race] === undefined) {
      values.race = POOLED_VALUE
    }
    return { ...cell, values }
  })

// A tract holding less than this share of the district's adults is too
// small to send anyone to on its own.
const MIN_TRACT_SHARE = 0.01

export interface TractShortfall {
  tract: string
  censusShare: number
  share: number
}

// The tracts outreach has barely reached: their share of the people is
// half their share of the district's adults or less, or trails it by the
// gap that names a group. Measured before weighting, on who was reached.
export const tractShortfalls = (
  respondents: RespondentCell[],
  tractAdults: Map<string, number>,
): TractShortfall[] => {
  const census = shares(Object.fromEntries(tractAdults))
  if (!census) return []
  const answered = new Map<string, number>()
  let placed = 0
  for (const cell of respondents) {
    if (cell.tract === null || census[cell.tract] === undefined) continue
    answered.set(cell.tract, (answered.get(cell.tract) ?? 0) + cell.count)
    placed += cell.count
  }
  return Object.entries(census)
    .map(([tract, censusShare]) => ({
      tract,
      censusShare,
      share: placed === 0 ? 0 : (answered.get(tract) ?? 0) / placed,
    }))
    .filter(
      ({ censusShare, share }) =>
        censusShare >= MIN_TRACT_SHARE &&
        (share <= censusShare / 2 ||
          censusShare - share >= MIN_UNDERREPRESENTED_GAP),
    )
    .sort((a, b) => a.tract.localeCompare(b.tract))
}

export const unreachedTracts = (
  respondents: RespondentCell[],
  tractAdults: Map<string, number>,
): string[] =>
  tractShortfalls(respondents, tractAdults).map(({ tract }) => tract)

// Weights the answers to the district's census mix, pooling small groups
// first.
export const weighToCensus = (
  respondents: RespondentCell[],
  census: WeightingCensus,
): RakingResult => {
  let targets = weightingTargets(census)
  let cells = placeCells(toRakingCells(respondents), targets)
  for (const dimension of Object.keys(targets)) {
    const pooled = poolSmallValues(
      cells,
      targets,
      dimension,
      MIN_ANSWERS_PER_WEIGHTING_GROUP,
      POOLED_VALUE,
    )
    cells = pooled.cells
    targets = pooled.targets
  }
  return rake(cells, targets)
}
