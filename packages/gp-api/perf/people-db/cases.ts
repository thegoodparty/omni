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

export const DEFAULT_ITERATIONS = 5

const NONE = FILTER_VARIANTS.find((v) => v.name === 'none') as FilterVariant
const NARROW_HIGHSELECTIVITY = FILTER_VARIANTS.find(
  (v) => v.name === 'narrow-highselectivity',
) as FilterVariant

// Heavy statewide cells hold a connection for seconds; run them fewer times so
// a full latency pass stays bounded.
const iterationsFor = (
  queryType: QueryType,
  cohort: Cohort,
  variant: FilterVariant,
): number => {
  if (cohort.band !== 'statewide') return DEFAULT_ITERATIONS
  if (queryType === 'csv') return 2
  if (queryType === 'list' && variant.name === 'broad-lowselectivity') return 2
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
    // Statewide csv with no filter would stream ~23M rows; narrow it down.
    push(
      'csv',
      cohort,
      cohort.band === 'statewide' ? NARROW_HIGHSELECTIVITY : NONE,
    )
    push('stats', cohort, NONE)
  }
  return cases
}
