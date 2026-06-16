import type { MandatoryFilter } from '@/llm/tools/districtInsights.tool'
import type { ConstituentDataScope } from '@/llm/tools/queryConstituentData.tool'

// Suppression floor for aggregate cells. Counts below this are dropped before
// any result reaches the model (anti-differencing backstop).
const CONSTITUENT_MIN_CELL_SIZE = 100

export interface ConstituentTableConfig {
  table: string
  dimensions: string[]
}

// App-layer allowlist (lever 1): a deliberate, code-reviewed security control
// kept in code (typed, reviewed, covered by bypass tests) NOT env. Add a table
// here only when the data team approves it (one reviewed line). Empty by
// default, so the tool stays unregistered until an approved table lands.
// TODO(data-team): add the approved aggregate table(s), e.g.
//   { table: 'constituent_aggregates', dimensions: ['age_band', 'gender'] }
export const CONSTITUENT_TABLES: ConstituentTableConfig[] = []

// Hard legal line: these columns must NEVER appear in any clause. App-side
// defensive backstop layered on top of the warehouse credential's column
// denies. These are best-effort guesses at the names.
// TODO(data-team): confirm the EXACT column names in the approved table so the
// forbidden list matches reality (the warehouse grant is the primary control).
const FORBIDDEN_COLUMNS = new Set([
  'party',
  'partisan_lean',
  'registered_party',
  'name',
  'first_name',
  'last_name',
  'address',
  'phone',
  'email',
  'voter_id',
])

export const buildConstituentDataScope = (
  districtFilters: MandatoryFilter[],
  tables: ConstituentTableConfig[],
): ConstituentDataScope => ({
  allowedTables: new Set(tables.map((t) => t.table)),
  allowedDimensions: new Set(tables.flatMap((t) => t.dimensions)),
  forbiddenColumns: FORBIDDEN_COLUMNS,
  mandatoryFilters: districtFilters,
  minCellSize: CONSTITUENT_MIN_CELL_SIZE,
})
