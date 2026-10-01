import type { BootstrapConfig, Rng } from './config'

// A cluster bootstrap over CASES, which is the whole point of the file.
//
// Attempts of one case, and the two orders of one pair, are correlated:
// they share an input, a seed state and whatever that case happens to be
// hard about. Resampling individual judgments would treat them as
// independent observations and report an interval far narrower than the
// evidence supports — the classic way a noisy comparison comes out looking
// decisive. Resampling whole cases keeps the correlation inside the
// resampled unit, which is what makes the interval honest.
//
// It looks like it wants numpy and it is about twenty lines.

export interface Interval {
  lower: number
  upper: number
}

export class EmptyResampleError extends Error {}

// Deterministic PRNG (mulberry32), so a sweep's interval is reproducible
// from a seed and a test can assert an exact number instead of a range.
export const createRng = (seed: number): Rng => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

export const mean = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length

const at = (values: readonly number[], index: number): number => {
  const value = values[index]
  if (value === undefined) {
    throw new EmptyResampleError(
      `index ${index} is outside a series of ${values.length}`,
    )
  }
  return value
}

// Nearest-rank on the sorted resample means. Simple and stated rather than
// interpolated, so the number in a report can be reproduced by hand.
const percentile = (sorted: readonly number[], q: number): number =>
  at(
    sorted,
    Math.min(
      sorted.length - 1,
      Math.max(0, Math.round(q * (sorted.length - 1))),
    ),
  )

// `caseScores` is one number per CASE — already averaged over that case's
// attempts and orders by the caller. Handing this function judgment-level
// scores is the mistake it exists to prevent, and the caller's own test
// asserts the interval widens when the same judgments are clustered into
// fewer cases.
export const bootstrapCi = (
  caseScores: readonly number[],
  config: BootstrapConfig,
  rng: Rng,
): Interval | null => {
  const n = caseScores.length
  if (n === 0) return null
  // A null rather than a throw, because this is a config value that exists
  // to be edited and nothing catches a throw from here: the sweep would die
  // instead of reporting a verdict without an interval, which every caller
  // already handles. And the throw it would die of names the case series
  // ("index -1 is outside a series of 0"), pointing a debugger at the
  // corpus when the iteration count is what is wrong.
  if (config.iterations <= 0) return null
  const resampleMeans: number[] = []
  for (let iteration = 0; iteration < config.iterations; iteration++) {
    let sum = 0
    for (let draw = 0; draw < n; draw++) {
      sum += at(caseScores, Math.min(n - 1, Math.floor(rng() * n)))
    }
    resampleMeans.push(sum / n)
  }
  resampleMeans.sort((a, b) => a - b)
  const alpha = (1 - config.confidence) / 2
  return {
    lower: percentile(resampleMeans, alpha),
    upper: percentile(resampleMeans, 1 - alpha),
  }
}
