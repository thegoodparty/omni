// A group of respondents who share a value on every dimension. Null means
// the value is unknown: the cell sits out that dimension only.
export interface RakingCell {
  count: number
  values: Record<string, string | null>
}

// Census share of each value, per dimension. Shares in a dimension sum to 1.
export type RakingTargets = Record<string, Record<string, number>>

export interface RakingOptions {
  // Weights stay within these multiples of the average weight, so a handful
  // of people never speak for a whole group.
  minWeight: number
  maxWeight: number
  maxIterations: number
  tolerance: number
}

export const DEFAULT_RAKING_OPTIONS: RakingOptions = {
  minWeight: 0.2,
  maxWeight: 5,
  maxIterations: 100,
  tolerance: 1e-6,
}

export interface RakingGap {
  dimension: string
  value: string
  share: number
  // Before weighting: who actually answered.
  unweightedShare: number
  censusShare: number
}

export interface RakingResult {
  // Per respondent in each cell, in the order given.
  weights: number[]
  // Kish: (sum of weights)^2 / sum of squared weights.
  effectiveSampleSize: number
  gaps: RakingGap[]
  // The largest absolute gap between a weighted share and the census.
  largestGap: number
}

interface Weighted {
  cell: RakingCell
  weight: number
}

const massOf = (weighted: Weighted[]): number =>
  weighted.reduce((sum, { cell, weight }) => sum + cell.count * weight, 0)

const weightedShares = (
  weighted: Weighted[],
  dimension: string,
): Map<string, number> => {
  const totals = new Map<string, number>()
  let known = 0
  for (const { cell, weight } of weighted) {
    const value = cell.values[dimension]
    if (value == null) continue
    const mass = cell.count * weight
    totals.set(value, (totals.get(value) ?? 0) + mass)
    known += mass
  }
  if (known === 0) return new Map()
  return new Map([...totals].map(([value, mass]) => [value, mass / known]))
}

const rakeOnce = (weighted: Weighted[], targets: RakingTargets): Weighted[] => {
  let next = weighted
  for (const [dimension, censusShares] of Object.entries(targets)) {
    const shares = weightedShares(next, dimension)
    // A value no one holds cannot be raised, so the values people do hold
    // split the whole known mass between them.
    const reachable = Object.entries(censusShares).filter(([value]) =>
      shares.has(value),
    )
    const reachableTotal = reachable.reduce((sum, [, share]) => sum + share, 0)
    if (reachableTotal <= 0) continue
    const factors = new Map(
      reachable.map(([value, share]) => [
        value,
        share / reachableTotal / (shares.get(value) ?? 1),
      ]),
    )
    next = next.map(({ cell, weight }) => {
      const value = cell.values[dimension]
      return {
        cell,
        weight: value == null ? weight : weight * (factors.get(value) ?? 1),
      }
    })
  }
  return next
}

const trim = (
  weighted: Weighted[],
  people: number,
  options: RakingOptions,
): Weighted[] => {
  const mean = massOf(weighted) / people
  return weighted.map(({ cell, weight }) => ({
    cell,
    weight: Math.min(
      options.maxWeight * mean,
      Math.max(options.minWeight * mean, weight),
    ),
  }))
}

const largestChange = (a: Weighted[], b: Weighted[]): number =>
  a.reduce(
    (max, { weight }, index) =>
      Math.max(max, Math.abs(weight - (b[index]?.weight ?? 0))),
    0,
  )

// Raking (iterative proportional fitting) on census marginals, with weights
// capped after each fit and the fit repeated until neither moves them.
export const rake = (
  cells: RakingCell[],
  targets: RakingTargets,
  options: RakingOptions = DEFAULT_RAKING_OPTIONS,
): RakingResult => {
  const people = cells.reduce((sum, cell) => sum + cell.count, 0)
  if (people === 0) {
    return { weights: [], effectiveSampleSize: 0, gaps: [], largestGap: 0 }
  }
  let weighted: Weighted[] = cells.map((cell) => ({ cell, weight: 1 }))
  for (let round = 0; round < options.maxIterations; round++) {
    const bounded = trim(rakeOnce(weighted, targets), people, options)
    const moved = largestChange(bounded, weighted)
    weighted = bounded
    if (moved < options.tolerance) break
  }

  // Normalized so the weights average 1 per respondent.
  const mass = massOf(weighted)
  weighted = weighted.map(({ cell, weight }) => ({
    cell,
    weight: (weight * people) / mass,
  }))
  const sumSquares = weighted.reduce(
    (sum, { cell, weight }) => sum + cell.count * weight ** 2,
    0,
  )

  const unweighted = cells.map((cell) => ({ cell, weight: 1 }))
  const gaps = Object.entries(targets).flatMap(([dimension, censusShares]) => {
    const shares = weightedShares(weighted, dimension)
    if (shares.size === 0) return []
    const rawShares = weightedShares(unweighted, dimension)
    return Object.entries(censusShares).map(([value, censusShare]) => ({
      dimension,
      value,
      share: shares.get(value) ?? 0,
      unweightedShare: rawShares.get(value) ?? 0,
      censusShare,
    }))
  })
  return {
    weights: weighted.map(({ weight }) => weight),
    effectiveSampleSize: people ** 2 / sumSquares,
    gaps,
    largestGap: gaps.reduce(
      (max, gap) => Math.max(max, Math.abs(gap.share - gap.censusShare)),
      0,
    ),
  }
}

// Values with fewer than `minCount` respondents pool into one `pooledValue`,
// in both the cells and the census targets, so no small group gets a weight
// it cannot carry.
export const poolSmallValues = (
  cells: RakingCell[],
  targets: RakingTargets,
  dimension: string,
  minCount: number,
  pooledValue: string,
): { cells: RakingCell[]; targets: RakingTargets } => {
  const censusShares = targets[dimension] ?? {}
  const counts = new Map<string, number>()
  for (const cell of cells) {
    const value = cell.values[dimension]
    if (value != null) counts.set(value, (counts.get(value) ?? 0) + cell.count)
  }
  const small = new Set(
    Object.keys(censusShares).filter(
      (value) => (counts.get(value) ?? 0) < minCount,
    ),
  )
  if (small.size === 0) return { cells, targets }
  const pooledTargets: Record<string, number> = {}
  for (const [value, share] of Object.entries(censusShares)) {
    const key = small.has(value) ? pooledValue : value
    pooledTargets[key] = (pooledTargets[key] ?? 0) + share
  }
  return {
    cells: cells.map((cell) => {
      const value = cell.values[dimension]
      return value != null && small.has(value)
        ? { ...cell, values: { ...cell.values, [dimension]: pooledValue } }
        : cell
    }),
    targets: { ...targets, [dimension]: pooledTargets },
  }
}
