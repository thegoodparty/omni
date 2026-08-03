import { COHORTS, type Cohort } from './cohorts'
import { FILTER_VARIANTS, type FilterVariant } from './filterVariants'

export type QueryType =
  | 'list'
  | 'count'
  | 'overlap'
  | 'sample'
  | 'search'
  | 'csv'
  | 'stats'

export type BenchCase = {
  id: string
  queryType: QueryType
  cohort: Cohort
  variant: FilterVariant
  iterations: number
}

// 1 cold + 7 warm: enough warm samples that p50/p95 mean something (a 4-warm
// p95 was essentially the max).
export const DEFAULT_ITERATIONS = 8

// Heavy statewide cells run fewer times to bound the pass, but never below
// 1 cold + 2 warm so every reported number is still an aggregate.
const HEAVY_ITERATIONS = 3

const NONE = FILTER_VARIANTS.find((v) => v.name === 'none') as FilterVariant

// Heavy statewide cells hold a connection for seconds; run them fewer times so
// a full latency pass stays bounded.
const iterationsFor = (
  queryType: QueryType,
  cohort: Cohort,
  variant: FilterVariant,
): number => {
  if (cohort.band !== 'statewide') return DEFAULT_ITERATIONS
  if (queryType === 'list' && variant.name === 'broad-lowselectivity') {
    return HEAVY_ITERATIONS
  }
  return DEFAULT_ITERATIONS
}

export const buildLatencyCases = (
  cohorts: readonly Cohort[] = COHORTS,
  variants: readonly FilterVariant[] = FILTER_VARIANTS,
): BenchCase[] => {
  const cases: BenchCase[] = []
  const push = (queryType: QueryType, cohort: Cohort, variant: FilterVariant) =>
    cases.push({
      id: `${queryType}:${cohort.band}:${variant.name}`,
      queryType,
      cohort,
      variant,
      iterations: iterationsFor(queryType, cohort, variant),
    })

  for (const cohort of cohorts) {
    // Full variant axis for the two hot, filter-sensitive paths.
    for (const variant of variants) {
      push('list', cohort, variant)
      push('count', cohort, variant)
    }
    // One representative cell per cohort for the rest.
    push('search', cohort, NONE)
    push('sample', cohort, NONE)
    push('overlap', cohort, NONE)
    // CSV is a full unfiltered export. Skip statewide: a ~23M-row COPY runs for
    // minutes and CSV time is ~linear in row count (see small/medium/large), so
    // statewide adds no insight and would dominate the pass.
    if (cohort.band !== 'statewide') push('csv', cohort, NONE)
    push('stats', cohort, NONE)
  }
  return cases
}
