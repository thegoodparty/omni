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

// The paths that hold a connection longest are the ones that saturate the
// 50-connection pool first.
export const LOAD_SCENARIOS: readonly LoadScenario[] = [
  // The production failure shape, at full fidelity: ListsIndex fires one whole
  // GET /v1/contacts/list-detail per saved list on mount, and each of those is
  // 4 aggregates. So concurrency here is SAVED LISTS, not queries — c=10 is a
  // 10-list page load and already ~40 queries in flight. On 2026-08-13 one org
  // with ~20 lists produced 201 timeouts in 19 minutes, 22 of them inside a
  // single second, while the same query single-shot measures ~1.7s. If this
  // scenario passes at c=50 and prod still 504s, the gap is elsewhere.
  {
    id: 'load:list-detail:mega',
    queryType: 'list-detail',
    band: 'mega',
    concurrencyLevels: LEVELS,
    targetConcurrency: 50,
    maxErrorRate: 0,
  },
  // Same fan-out against the slow partition — the two failure modes stacked.
  {
    id: 'load:list-detail:large',
    queryType: 'list-detail',
    band: 'large',
    concurrencyLevels: LEVELS,
    targetConcurrency: 50,
    maxErrorRate: 0,
  },
  {
    id: 'load:count:mega',
    queryType: 'count',
    band: 'mega',
    concurrencyLevels: LEVELS,
    targetConcurrency: 50,
    maxErrorRate: 0,
  },
  // The slow-plan counterpart: same query, 60% of the membership, but in the
  // 63GB CA partition where it measured 18.7s warm. Concurrency is not the
  // variable here — one of these already nearly exhausts the 25s budget.
  {
    id: 'load:count:large',
    queryType: 'count',
    band: 'large',
    concurrencyLevels: LEVELS,
    targetConcurrency: 50,
    maxErrorRate: 0,
  },
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
