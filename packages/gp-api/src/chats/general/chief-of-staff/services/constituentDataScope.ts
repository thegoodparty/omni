import type { MandatoryFilter } from '@/llm/tools/districtInsights.tool'
import type { ConstituentDataScope } from '@/llm/tools/queryConstituentData.tool'
import { SERVE_AGENT_VOTER_DIMENSIONS } from './constituentDimensions.serveAgentVoters'
import { SERVE_AGENT_VOTER_SUGGESTED_DIMENSIONS } from './constituentSuggestedDimensions.serveAgentVoters'

// Suppression floor for aggregate cells. Counts below this are dropped before
// any result reaches the model (anti-differencing backstop).
const CONSTITUENT_MIN_CELL_SIZE = 100

export interface ConstituentTableConfig {
  table: string
  dimensions: string[]
}

// App-layer allowlist (lever 1): a deliberate, code-reviewed security control
// kept in code (typed, reviewed, covered by bypass tests) NOT env. The approved
// surface is the purpose-built serve_agent_voters mart, curated upstream by the
// research + product teams: one pseudonymous row per voter (voter_key is a
// SHA-256 hash, never the raw L2 id), modeled issue scores, and geography. The
// table is the allowlist — columns are added/removed there, and the dimension
// list mirrors it (regenerate constituentDimensions.serveAgentVoters.ts when the
// schema changes). Aggregate-only safety still comes from the SQL validator,
// mandatory district filters, the forbidden-column backstop, and the cell-size
// floor below.
export const CONSTITUENT_TABLES: ConstituentTableConfig[] = [
  {
    table: 'serve_agent_voters',
    dimensions: SERVE_AGENT_VOTER_DIMENSIONS,
  },
]

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
  advertisedDimensions: SERVE_AGENT_VOTER_SUGGESTED_DIMENSIONS,
  forbiddenColumns: FORBIDDEN_COLUMNS,
  mandatoryFilters: districtFilters,
  minCellSize: CONSTITUENT_MIN_CELL_SIZE,
  audienceNoun: 'constituent',
  // The serve catalog carries meaning labels, value tokens, and the coverage /
  // off-center marks that hsScoreSemantics refers to (verified against
  // serve_agent_voters, 2026-08-04).
  catalogCarriesScoreMarks: true,
})
