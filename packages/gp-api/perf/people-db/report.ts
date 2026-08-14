import type { Summary } from './stats'

export type CaseResult = {
  id: string
  queryType: string
  band: string
  variant: string
  iterations: number
  failures: number
  errors: string[]
  cold: number | null
  warm: Summary
}

export const artifactPath = (meta: {
  env: string
  mode: string
  gitSha: string
}): string =>
  `scripts/output/people-db-bench-${meta.env}-${meta.gitSha}-${meta.mode}.json`

export const buildArtifact = (
  meta: { env: string; mode: string; gitSha: string; startedAt: string },
  results: unknown[],
): object => ({ ...meta, results })

const BAND_ORDER = ['small', 'medium', 'large', 'statewide']
const QUERY_ORDER = [
  'list',
  'count',
  'search',
  'sample',
  'overlap',
  'csv',
  'stats',
]
const VARIANT_ORDER = [
  'none',
  'single-boolean',
  'single-multivalue',
  'broad-lowselectivity',
  'narrow-highselectivity',
  'numeric-range',
]
// Only list and count are run across the filter variants; the rest run one
// representative (no-filter) cell per cohort.
const VARIED = new Set(['list', 'count'])

// Always printed above the matrix so a first-time reader can decode it without
// hunting through the code.
export const buildLegend = (): string =>
  [
    'people-db benchmark — latency',
    '',
    'Each cohort is one real district, sized by registered voters (all in CA):',
    '  small ~8k · medium ~65k · large ~400k · statewide = whole state ~23M.',
    '',
    'Query types (the people-db service methods under test):',
    '  list    a page of contacts + the pagination total (runs a count too)',
    '  count   count + avg age/income for a filtered set (getAggregates)',
    '  search  name search (trigram)',
    '  sample  random sample of contacts',
    '  overlap saved-list overlap count',
    '  csv     full unfiltered CSV export (skipped for statewide: ~minutes)',
    '  stats   precomputed district totals (no live scan)',
    '',
    'Filter variants (list and count are run against each; the rest use none):',
    '  none                    no filter — the whole district',
    '  single-boolean          one yes/no flag (has a cell phone)',
    '  single-multivalue       one field, pick-from-a-list (party in {Dem,Rep})',
    '  broad-lowselectivity    keeps MOST people (gender & education present)',
    '  narrow-highselectivity  15 conditions at once, keeps VERY FEW people',
    '  numeric-range           number between X and Y (age 18-65, income band)',
    '  (selectivity = how much a filter narrows the crowd; low = keeps most,',
    '   high = keeps few. multivalue = choose from a list. range = between.)',
    '',
    'Cells are median/max in ms over the WARM runs — the typical time and the',
    'worst one observed. Each case runs 8 times: 1 cold (first hit, discarded)',
    'then 7 warm; heavy statewide cells run fewer (marked *). We report max, not',
    'a p95: 7 samples is far too few to estimate a real 95th percentile, so max',
    'is the honest "worst seen" (a big gap from the median = an intermittent',
    'stall). Markers: * = only 2 warm samples, !k = k of the runs errored, FAIL',
    '= every run errored, — = not run. Cold times and per-run detail are in the',
    'JSON artifact.',
  ].join('\n')

type MatrixRow = { queryType: string; variant: string; label: string }

const matrixRows = (results: CaseResult[]): MatrixRow[] => {
  const rows: MatrixRow[] = []
  for (const q of QUERY_ORDER) {
    const forQuery = results.filter((r) => r.queryType === q)
    if (forQuery.length === 0) continue
    if (VARIED.has(q)) {
      for (const v of VARIANT_ORDER) {
        if (forQuery.some((r) => r.variant === v)) {
          rows.push({ queryType: q, variant: v, label: `${q} ${v}` })
        }
      }
    } else {
      rows.push({ queryType: q, variant: 'none', label: q })
    }
  }
  return rows
}

const cellText = (r: CaseResult | undefined): string => {
  if (!r) return '—'
  if (r.failures >= r.iterations) return `FAIL(${r.failures}/${r.iterations})`
  const lowSamples = r.warm.count < 4 ? '*' : ''
  const someFailed = r.failures > 0 ? `!${r.failures}` : ''
  return `${Math.round(r.warm.p50)}/${Math.round(r.warm.max)}${someFailed}${lowSamples}`
}

export const formatMatrix = (results: CaseResult[]): string => {
  const bands = BAND_ORDER.filter((b) => results.some((r) => r.band === b))
  const rows = matrixRows(results)
  const labelWidth = Math.max(5, ...rows.map((r) => r.label.length))
  // wide enough that the longest cell (e.g. "10932/11163!1*") keeps a gutter
  const colWidth = 16
  const cell = (row: MatrixRow, band: string): string =>
    cellText(
      results.find(
        (r) =>
          r.queryType === row.queryType &&
          r.variant === row.variant &&
          r.band === band,
      ),
    )
  const header =
    'query (median/max ms)'.padEnd(labelWidth) +
    bands.map((b) => b.padStart(colWidth)).join('')
  const lines = rows.map(
    (row) =>
      row.label.padEnd(labelWidth) +
      bands.map((b) => cell(row, b).padStart(colWidth)).join(''),
  )
  return [header, ...lines].join('\n')
}
