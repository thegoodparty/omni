import type { MandatoryFilter } from '@/llm/tools/districtInsights.tool'
import type { ConstituentDataScope } from '@/llm/tools/queryConstituentData.tool'

// Suppression floor for aggregate cells. Counts below this are dropped before
// any result reaches the model (anti-differencing backstop).
const CONSTITUENT_MIN_CELL_SIZE = 100

// Approved table + coarse breakdown dimensions are env-supplied and EMPTY by
// default. The tool only registers once a real table is configured, so leaving
// these unset keeps the tool off in prod/local until the credential AND the
// approved schema are deployed together.
// TODO(data-team): provide the single approved aggregate table name (set
// SERVE_CONSTITUENT_TABLE) and the coarse, non-quasi-identifier breakdown
// dimensions (set SERVE_CONSTITUENT_DIMENSIONS as a comma-separated list).
const parseCsvEnv = (raw: string | undefined): string[] => {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

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
): ConstituentDataScope => ({
  allowedTables: new Set(parseCsvEnv(process.env.SERVE_CONSTITUENT_TABLE)),
  allowedDimensions: new Set(
    parseCsvEnv(process.env.SERVE_CONSTITUENT_DIMENSIONS),
  ),
  forbiddenColumns: FORBIDDEN_COLUMNS,
  mandatoryFilters: districtFilters,
  minCellSize: CONSTITUENT_MIN_CELL_SIZE,
})
