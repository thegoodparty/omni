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
  if (census.genderShares) {
    const gender = shares(census.genderShares)
    if (gender) targets.gender = gender
  }
  return targets
}

export const toRakingCells = (cells: RespondentCell[]): RakingCell[] =>
  cells.map((cell) => ({
    count: cell.count,
    values: {
      age: cell.ageBand,
      tenure: cell.tenure,
      tract: cell.tract,
      gender: cell.gender,
    },
  }))

// A tract holding less than this share of the district's adults is too
// small to send anyone to on its own.
const MIN_TRACT_SHARE = 0.01

// The tracts outreach has barely reached: their share of the answers is
// half their share of the district's adults or less, or trails it by the
// gap that names a group. Measured before weighting, on who answered.
export const unreachedTracts = (
  respondents: RespondentCell[],
  tractAdults: Map<string, number>,
): string[] => {
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
    .filter(([tract, censusShare]) => {
      if (censusShare < MIN_TRACT_SHARE) return false
      const share = placed === 0 ? 0 : (answered.get(tract) ?? 0) / placed
      return (
        share <= censusShare / 2 ||
        censusShare - share >= MIN_UNDERREPRESENTED_GAP
      )
    })
    .map(([tract]) => tract)
    .sort()
}

// Weights the answers to the district's census mix, pooling small groups
// first. A respondent living outside every known tract sits out the
// neighborhood dimension.
export const weighToCensus = (
  respondents: RespondentCell[],
  census: WeightingCensus,
): RakingResult => {
  let targets = weightingTargets(census)
  let cells = toRakingCells(respondents).map((cell) => {
    const tract = cell.values.tract
    return tract != null && targets.tract?.[tract] === undefined
      ? { ...cell, values: { ...cell.values, tract: null } }
      : cell
  })
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
