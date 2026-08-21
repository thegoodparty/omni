import { COHORTS, type Cohort } from './cohorts'
import { FILTER_VARIANTS, type FilterVariant } from './filterVariants'

export type QueryType =
  | 'list'
  | 'count'
  | 'list-detail'
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

export const QUERY_DESCRIPTIONS: Record<QueryType, string> = {
  list:
    'One page of contacts plus the pagination total. Runs a count as well ' +
    'as the page fetch, so it is two queries behind one request.',
  count:
    'The count and average age/income behind a single tile (getAggregates). ' +
    'One query, and the load-bearing one: it has to aggregate the whole ' +
    'filtered set, not just a page of it.',
  'list-detail':
    'One whole GET /v1/contacts/list-detail: the base tile resolved first, ' +
    'then its three channel tiles in parallel. Four aggregates, not one, so ' +
    'reading count alone understates a real request by roughly 4x.',
  search: 'Name search across the district, served by a trigram index.',
  sample: 'A random sample of contacts, used to seed lists and previews.',
  overlap:
    'Saved-list overlap count: how many people the current selection and a ' +
    'saved filter set have in common.',
  csv:
    'Full CSV export of the district, streamed to the client. The only path ' +
    'that sets statement_timeout = 0, so nothing stops a slow one.',
  stats:
    'Precomputed district totals. No live scan at all, so this is the floor ' +
    'that every other row should be read against.',
}

// 1 cold + 7 warm: enough warm samples that p50/p95 mean something (a 4-warm
// p95 was essentially the max).
export const DEFAULT_ITERATIONS = 8

// Heavy statewide cells run fewer times to bound the pass, but never below
// 1 cold + 2 warm so every reported number is still an aggregate.
const HEAVY_ITERATIONS = 3

const NONE = FILTER_VARIANTS.find((v) => v.name === 'none') as FilterVariant
// Every list-detail 504 in the week to 2026-08-16 was segment-scoped, so the
// unfiltered universe cell alone would miss the shape that actually fails. A
// party pick is the most common real saved-list filter.
const SAVED_LIST = FILTER_VARIANTS.find(
  (v) => v.name === 'single-multivalue',
) as FilterVariant

// Heavy cells hold a connection for seconds; run them fewer times so a full
// latency pass stays bounded. `large` qualifies as of 2026-08-16: its
// unfiltered aggregate measured 18.7s warm and timed out cold, so 8 iterations
// is ~2.5 minutes on a single cell. `mega` does NOT — despite 2.3x the
// membership it lands at ~1.7s (see cohorts.ts), so it runs the full count.
const iterationsFor = (
  queryType: QueryType,
  cohort: Cohort,
  variant: FilterVariant,
): number => {
  const heavyOnLarge = queryType === 'count' || queryType === 'list-detail'
  if (cohort.band === 'large' && heavyOnLarge) return HEAVY_ITERATIONS
  if (cohort.band !== 'statewide') return DEFAULT_ITERATIONS
  if (queryType === 'list' && variant.name === 'broad-lowselectivity') {
    return HEAVY_ITERATIONS
  }
  // A 5k-id array against the 23M-row no-join scan is the slowest shape the
  // suite can build; at 8 iterations the three outreach variants alone would
  // add most of an hour to the pass.
  if (variant.idSet) return HEAVY_ITERATIONS
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
    // The whole request, at every district size, both as the universe row
    // (unfiltered) and as a saved list (filtered) — the two ways the sheet is
    // actually opened.
    push('list-detail', cohort, NONE)
    push('list-detail', cohort, SAVED_LIST)
    // One representative cell per cohort for the rest.
    push('search', cohort, NONE)
    push('sample', cohort, NONE)
    push('overlap', cohort, NONE)
    // CSV is a full unfiltered export. Skip the two biggest bands: a ~23M-row
    // (statewide) or ~900k-row (mega) COPY runs for minutes and CSV time is
    // ~linear in row count (see small/medium/large), so they add no insight and
    // would dominate the pass.
    if (cohort.band !== 'statewide' && cohort.band !== 'mega') {
      push('csv', cohort, NONE)
    }
    push('stats', cohort, NONE)
  }
  return cases
}
