export type Summary = {
  count: number
  min: number
  max: number
  mean: number
  p50: number
  p95: number
}

const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 0
  const rank = Math.ceil((p / 100) * sorted.length)
  const idx = Math.min(Math.max(rank, 1), sorted.length) - 1
  return sorted[idx] ?? 0
}

export const summarize = (samplesMs: number[]): Summary => {
  if (samplesMs.length === 0) {
    return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0 }
  }
  const sorted = [...samplesMs].sort((a, b) => a - b)
  const sum = sorted.reduce((acc, v) => acc + v, 0)
  return {
    count: sorted.length,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    mean: sum / sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
  }
}

export const errorRate = (total: number, failures: number): number =>
  total === 0 ? 0 : failures / total
