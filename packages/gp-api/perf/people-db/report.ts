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

const BAND_ORDER = ['small', 'medium', 'large', 'mega', 'statewide']
const QUERY_ORDER = [
  'list',
  'count',
  'list-detail',
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
  'channel-landline',
  'channel-address',
]
// list and count run across every filter variant; list-detail runs two
// (unfiltered universe row + a saved list); the rest run one representative
// (no-filter) cell per cohort.
const VARIED = new Set(['list', 'count', 'list-detail'])

// Always printed above the matrix so a first-time reader can decode it without
// hunting through the code.
export const buildLegend = (): string =>
  [
    'people-db benchmark — latency',
    '',
    'Each cohort is one real district, sized by registered voters (CA unless',
    'noted): small ~8k · medium ~65k · large ~400k · mega ~900k (Orange County,',
    'FL) · statewide = whole state ~23M. Size does NOT order these by cost:',
    'statewide skips the DistrictVoter join entirely (useVoterOnlyPath), and',
    "mega has 2.3x large's membership but sits in a 17GB state partition vs",
    "CA's 63GB — as of 2026-08-16 large was the slowest count of the three.",
    '',
    'Query types (the people-db service methods under test):',
    '  list    a page of contacts + the pagination total (runs a count too)',
    '  count   count + avg age/income for a filtered set (getAggregates)',
    '  list-detail  ONE whole GET /v1/contacts/list-detail: the base count then',
    '          its 3 channel tiles in parallel (~4 counts, not 1)',
    '  search  name search (trigram)',
    '  sample  random sample of contacts',
    '  overlap saved-list overlap count',
    '  csv     full unfiltered CSV export (skipped for mega/statewide: ~mins)',
    '  stats   precomputed district totals (no live scan)',
    '',
    'Filter variants (list and count are run against each; the rest use none):',
    '  none                    no filter — the whole district',
    '  single-boolean          one yes/no flag (has a cell phone)',
    '  single-multivalue       one field, pick-from-a-list (party in {Dem,Rep})',
    '  broad-lowselectivity    keeps MOST people (gender & education present)',
    '  narrow-highselectivity  15 conditions at once, keeps VERY FEW people',
    '  numeric-range           number between X and Y (age 18-65, income band)',
    '  channel-landline        has a landline (list-detail phone-banking tile)',
    '  channel-address         has an address (list-detail door-knocking tile)',
    '  (selectivity = how much a filter narrows the crowd; low = keeps most,',
    '   high = keeps few. multivalue = choose from a list. range = between.)',
    '',
    'Cells are cold|median/max in ms. COLD is the first hit — the one that pays',
    'for an unwarmed buffer pool, and the number to read first: the people-db',
    'loader cuts prod over to a brand-new cluster (see cohorts.ts), so in',
    'production every district is cold at once. median/max are over the WARM',
    'runs that follow. Each case runs 8 times: 1 cold then 7 warm; heavy cells',
    '(large count/list-detail, the broad statewide list) run fewer (marked *).',
    'A cold cell reading ERR means the cold run failed while warm runs passed —',
    'the exact production shape, not a flake. We report max, not',
    'a p95: 7 samples is far too few to estimate a real 95th percentile, so max',
    'is the honest "worst seen" (a big gap from the median = an intermittent',
    'stall). Markers: * = only 2 warm samples, !k = k of the runs errored, FAIL',
    '= every run errored, — = not run. Per-run detail is in the JSON artifact.',
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
  // Cold leads. A cold miss is the shape production actually fails in — the
  // people-db loader cuts prod over to a brand-new cluster with an empty
  // buffer pool, so the first hit per district is the one that blows the 25s
  // statement timeout. 'ERR' means the cold run itself failed while warm runs
  // succeeded, which is precisely that case and must not be hidden.
  const cold = r.cold === null ? 'ERR' : String(Math.round(r.cold))
  return `${cold}|${Math.round(r.warm.p50)}/${Math.round(r.warm.max)}${someFailed}${lowSamples}`
}

export const formatMatrix = (results: CaseResult[]): string => {
  const bands = BAND_ORDER.filter((b) => results.some((r) => r.band === b))
  const rows = matrixRows(results)
  const labelWidth = Math.max(5, ...rows.map((r) => r.label.length))
  // wide enough that the longest cell (e.g. "25114|10932/11163!1*") keeps a
  // gutter now that cold leads every cell
  const colWidth = 22
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
    'query (cold|median/max ms)'.padEnd(labelWidth) +
    bands.map((b) => b.padStart(colWidth)).join('')
  const lines = rows.map(
    (row) =>
      row.label.padEnd(labelWidth) +
      bands.map((b) => cell(row, b).padStart(colWidth)).join(''),
  )
  return [header, ...lines].join('\n')
}
