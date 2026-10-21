// A group of respondents who share a value on every dimension. Null means
// the value is unknown: the cell sits out that dimension only.
export interface RakingCell {
  count: number
  values: Record<string, string | null>
}

// Census share of each value, per dimension. Shares in a dimension sum to 1.
export type RakingTargets = Record<string, Record<string, number>>

export interface RakingGap {
  dimension: string
  value: string
  share: number
  // Before weighting: who actually answered.
  unweightedShare: number
  censusShare: number
}

// Values with fewer than `minCount` respondents pool into one `pooledValue`,
// in both the cells and the census targets, so no small group gets a weight
// it cannot carry. The weight cap handles a lone small value.
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
  // One small value has nothing to pool with, and keeps its name.
  if (small.size < 2) return { cells, targets }
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
