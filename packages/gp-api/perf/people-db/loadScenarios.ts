import { COHORTS, type Cohort } from './cohorts'
import { FILTER_VARIANTS, type FilterVariant } from './filterVariants'
import type { BenchCase, QueryType } from './cases'

export type LoadScenario = {
  id: string
  queryType: QueryType
  band: Cohort['band']
  concurrencyLevels: number[]
  targetConcurrency: number
  maxErrorRate: number
}

// Sweep past the 50-connection pool so the over-saturation cliff is still
// visible (100 = 2x the pool); the gate targets 50, the pool size.
const LEVELS = [1, 10, 50, 100]
const NONE = FILTER_VARIANTS.find((v) => v.name === 'none') as FilterVariant

// The two paths that hold a connection longest (statewide count, large filtered
// list) are the ones that saturate the 50-connection pool first.
export const LOAD_SCENARIOS: readonly LoadScenario[] = [
  {
    id: 'load:count:statewide',
    queryType: 'count',
    band: 'statewide',
    concurrencyLevels: LEVELS,
    targetConcurrency: 50,
    maxErrorRate: 0,
  },
  {
    id: 'load:list:large',
    queryType: 'list',
    band: 'large',
    concurrencyLevels: LEVELS,
    targetConcurrency: 50,
    maxErrorRate: 0,
  },
]

export const scenarioCase = (s: LoadScenario): BenchCase => {
  const cohort = COHORTS.find((c) => c.band === s.band)
  if (!cohort) throw new Error(`no cohort for band ${s.band}`)
  return {
    id: s.id,
    queryType: s.queryType,
    cohort,
    variant: NONE,
    iterations: 1,
  }
}
