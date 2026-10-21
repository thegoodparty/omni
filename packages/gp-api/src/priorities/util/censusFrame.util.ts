import type { DistrictCell } from '@/peopleDb/databricks/districtCensusSql.util'
import { weightingTargets, type WeightingCensus } from './censusWeighting.util'

// The dimensions the census sets the frame's margins on. Race stays with
// the voter file: the census publishes race over everyone, children
// included, so it is not a margin over the adults the model reweights to.
const RAKED = ['age', 'gender', 'tract'] as const
export type CensusFrameDimension = (typeof RAKED)[number]

const MAX_ITERATIONS = 50
const TOLERANCE = 1e-6

export interface CensusFrame {
  cells: DistrictCell[]
  // Dimensions whose census margin was missing or suppressed, so the frame
  // keeps the voter file's counts for them.
  fromVoterFile: CensusFrameDimension[]
}

const valueOf = (
  cell: DistrictCell,
  dimension: CensusFrameDimension,
): string | null => (dimension === 'age' ? cell.ageBand : cell[dimension])

const withoutValue = (
  cell: DistrictCell,
  dimension: CensusFrameDimension,
): DistrictCell =>
  dimension === 'age'
    ? { ...cell, ageBand: null }
    : { ...cell, [dimension]: null }

// The district's people from the voter file, reweighted so that age band,
// sex and tract take the census's adult shares (ACS B01001 by sex and age
// band, and adults per tract summed from block groups) and everything
// else, including how the dimensions overlap, stays the voter file's.
// People with a value unknown on a dimension keep their count and sit out
// that dimension; so does a tract the census has no adults for.
export const censusFrame = (
  cells: DistrictCell[],
  census: WeightingCensus,
): CensusFrame => {
  const targets = weightingTargets(census)
  const fromVoterFile: CensusFrameDimension[] = []
  const margins = new Map<CensusFrameDimension, Record<string, number>>()
  for (const dimension of RAKED) {
    const target = targets[dimension]
    if (target) margins.set(dimension, target)
    else fromVoterFile.push(dimension)
  }

  const placed = cells.map((cell) => {
    let next = cell
    for (const [dimension, target] of margins) {
      const value = valueOf(next, dimension)
      if (value !== null && target[value] === undefined) {
        next = withoutValue(next, dimension)
      }
    }
    return next
  })

  const weights = placed.map((cell) => cell.count)
  for (let round = 0; round < MAX_ITERATIONS; round++) {
    let drift = 0
    for (const [dimension, target] of margins) {
      const mass = new Map<string, number>()
      let known = 0
      placed.forEach((cell, i) => {
        const value = valueOf(cell, dimension)
        if (value === null) return
        const weight = weights[i] ?? 0
        mass.set(value, (mass.get(value) ?? 0) + weight)
        known += weight
      })
      // A census value no one in the file holds cannot be scaled to, so the
      // rest share its place.
      const reachable = [...mass.keys()].reduce(
        (sum, value) => sum + (target[value] ?? 0),
        0,
      )
      if (known === 0 || reachable === 0) continue
      const factors = new Map(
        [...mass].map(([value, held]) => [
          value,
          held === 0 ? 1 : (((target[value] ?? 0) / reachable) * known) / held,
        ]),
      )
      placed.forEach((cell, i) => {
        const value = valueOf(cell, dimension)
        const factor = value === null ? undefined : factors.get(value)
        if (factor === undefined) return
        drift = Math.max(drift, Math.abs(factor - 1))
        weights[i] = (weights[i] ?? 0) * factor
      })
    }
    if (drift < TOLERANCE) break
  }

  return {
    cells: placed.map((cell, i) => ({ ...cell, count: weights[i] ?? 0 })),
    fromVoterFile,
  }
}
