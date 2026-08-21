import type { Summary } from './stats'
import { COHORTS } from './cohorts'
import { FILTER_VARIANTS, ID_SAMPLE_SEED, ID_SET_SIZE } from './filterVariants'
import { QUERY_DESCRIPTIONS, type QueryType } from './cases'

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
  store: string
  gitSha: string
}): string =>
  `scripts/output/people-db-bench-${meta.env}-${meta.store}` +
  `-${meta.gitSha}-${meta.mode}.json`

// The descriptions travel WITH the results so anything downstream (the HTML
// artifact, a future CI dashboard) renders the same words the console legend
// printed, without re-deriving them from a copy that can drift.
export const buildArtifact = (
  meta: {
    env: string
    mode: string
    store: string
    gitSha: string
    startedAt: string
  },
  results: unknown[],
): object => ({
  ...meta,
  idSet: { size: ID_SET_SIZE, seed: ID_SAMPLE_SEED },
  descriptions: {
    queries: QUERY_DESCRIPTIONS,
    variants: Object.fromEntries(
      FILTER_VARIANTS.map((v) => [v.name, v.description]),
    ),
    bands: Object.fromEntries(
      COHORTS.map((c) => [
        c.band,
        {
          district: c.district,
          partition: c.partition,
          description: c.description,
        },
      ]),
    ),
  },
  results,
})

const BAND_ORDER = ['small', 'medium', 'large', 'mega', 'statewide']
const QUERY_ORDER: QueryType[] = [
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
  'outreach-include',
  'outreach-exclude',
  'outreach-mixed',
]
// list and count run across every filter variant; list-detail runs two
// (unfiltered universe row + a saved list); the rest run one representative
// (no-filter) cell per cohort.
const VARIED = new Set(['list', 'count', 'list-detail'])

// The legend prints the SAME description strings the JSON artifact carries, so
// the console and the HTML table can never disagree about what a row means.
const LABEL_WIDTH = 24
const LINE_WIDTH = 78

const describe = (name: string, description: string): string[] => {
  const label = `  ${name.padEnd(LABEL_WIDTH)}`
  const indent = ' '.repeat(label.length)
  const lines: string[] = []
  let current = label
  for (const word of description.split(' ')) {
    if (
      current.trimEnd().length > label.length &&
      `${current}${word}`.length > LINE_WIDTH
    ) {
      lines.push(current.trimEnd())
      current = indent
    }
    current += `${word} `
  }
  lines.push(current.trimEnd())
  return lines
}

const describeAll = (entries: [string, string][]): string[] =>
  entries.flatMap(([name, description]) => describe(name, description))

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
    ...describeAll(QUERY_ORDER.map((q) => [q, QUERY_DESCRIPTIONS[q]])),
    '',
    'Filter variants (list and count are run against each; the rest use none):',
    ...describeAll(FILTER_VARIANTS.map((v) => [v.name, v.description])),
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
  // A failed cold run is already reported by the ERR prefix and is counted in
  // r.failures, so subtract it — otherwise the same failure shows up twice and
  // !k reads as "a warm run also failed", which the legend says it means.
  const warmFailures = r.cold === null ? r.failures - 1 : r.failures
  const someFailed = warmFailures > 0 ? `!${warmFailures}` : ''
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
