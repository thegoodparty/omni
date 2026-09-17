import type { MandatoryFilter } from '@/llm/tools/districtInsights.tool'
import type { ConstituentDataScope } from '@/llm/tools/queryConstituentData.tool'
import type { ConstituentTableConfig } from '../../chief-of-staff/services/constituentDataScope'
import { WIN_AGENT_VOTER_DIMENSIONS } from './constituentDimensions.winAgentVoters'
import { WIN_AGENT_VOTER_SUGGESTED_DIMENSIONS } from './constituentSuggestedDimensions.winAgentVoters'

// Suppression floor for aggregate cells, same as Serve: counts below this are
// dropped before any result reaches the model (anti-differencing backstop).
const CONSTITUENT_MIN_CELL_SIZE = 100

// App-layer allowlist for the Win mart. The approved surface is
// goodparty_data_catalog.mart_win_agents.win_agent_voters: a sibling of the
// Serve mart that removes PII only and deliberately retains partisan and
// commercial fields for campaign targeting (see the spec in
// scratch/campaign-manager/win-constituent-data-spec.md). The table is the
// allowlist; regenerate the dimensions file when its schema changes.
export const WIN_CONSTITUENT_TABLES: ConstituentTableConfig[] = [
  {
    table: 'win_agent_voters',
    dimensions: WIN_AGENT_VOTER_DIMENSIONS,
  },
]

// Identity backstop only. Unlike Serve there is NO partisan entry here:
// the Win mart retains party/ideology columns by design and the product
// decision (2026-07-06) is that campaigns may query and be offered them.
// These identity names are already absent from the mart (PII removed
// upstream, LALVOTERID hashed to voter_key) — pure defense-in-depth.
const FORBIDDEN_COLUMNS = new Set([
  'name',
  'first_name',
  'last_name',
  'address',
  'phone',
  'email',
  'voter_id',
])

export const buildWinConstituentDataScope = (
  districtFilters: MandatoryFilter[],
  tables: ConstituentTableConfig[],
): ConstituentDataScope => ({
  allowedTables: new Set(tables.map((t) => t.table)),
  allowedDimensions: new Set(tables.flatMap((t) => t.dimensions)),
  advertisedDimensions: WIN_AGENT_VOTER_SUGGESTED_DIMENSIONS,
  forbiddenColumns: FORBIDDEN_COLUMNS,
  mandatoryFilters: districtFilters,
  minCellSize: CONSTITUENT_MIN_CELL_SIZE,
  partisanQueriesAllowed: true,
  audienceNoun: 'voter',
})
