import { defineAgent } from '@/agents/defineAgent'
import {
  databricksTool,
  type DatabricksScope,
} from '@/agents/tools/queryDatabricks'
import type { ToolContext } from '@/agents/tools/tool'
import { PrismaService } from '@/prisma/prisma.service'
import { RACE_OPPONENT_ACTIONS_PROMPT } from './race_opponent_actions.prompt'
import {
  RaceOpponentActionsInputSchema,
  RaceOpponentActionsOutputSchema,
} from './race_opponent_actions.schema'

// The manifest's scope.allowed_tables, in the form gp-api's principal can read.
// The manifest names the `dbt` model, whose grant does not survive a dbt rebuild;
// gp-api reads `mart_gp_api`, the schema with a schema-scoped SELECT for
// `mart_gp_api_readers`, and every catalog column this agent uses is on that mart
// view (src/agents/AGENTS.md, "The table must be one gp-api's principal can
// read").
const ACTIONS_TABLE = 'goodparty_data_catalog.mart_gp_api.gp_api_voters'

// The manifest's scope.max_rows.
const ACTIONS_MAX_ROWS = 1000

// The manifest's cell-size floor, which its Step 4 coverage rule states as
// "under ~25 voters the percentage is noise".
const ACTIONS_MIN_CELL_SIZE = 25

// The manifest's scope.dimensions. Every `hs_*` column is sliced by inside an
// aggregate's own CASE, never named in a WHERE, so none of them is a dimension:
// the grant stays at the activity flag and the tool's own jurisdiction columns.
const ACTIONS_DIMENSIONS = ['Active']

// The run's own jurisdiction, read from its stored input rather than from the
// model or the org: the dispatcher builds those params from
// DistrictResolverService, and a judge run's case carries its own district. A
// run with no state refuses every query, and one with no district (or half an
// L2 pair) is scoped to its state alone, which is the manifest's own degrade
// path (`haystaq_status: no_district` is the agent's choice, not this tool's).
export const actionsDatabricksScope = async (
  ctx: ToolContext,
): Promise<DatabricksScope | null> => {
  const run = await ctx.get(PrismaService).agentRun.findUnique({
    where: { id: ctx.runId },
    select: { input: true, organizationSlug: true },
  })
  if (!run || run.organizationSlug !== ctx.organizationSlug) return null
  const input = RaceOpponentActionsInputSchema.safeParse(run.input)
  if (!input.success) return null
  const { state, l2DistrictType, l2DistrictName } = input.data
  if (!state) return null
  // A half L2 pair cannot scope a district, and a column name that is not an
  // identifier is not one the tool can prove a clause against.
  if (Boolean(l2DistrictType) !== Boolean(l2DistrictName)) {
    return { state, district: null }
  }
  return {
    state,
    district:
      l2DistrictType && l2DistrictName
        ? { column: l2DistrictType, value: l2DistrictName }
        : null,
  }
}

// The race_opponent_actions experiment on gp-api's own agents: the chain's last
// link, turning the persisted summaries into stand-out action cards. Its
// instruction allows no web, so `queryDatabricks` is its only tool.
export const raceOpponentActionsAgent = defineAgent({
  input: RaceOpponentActionsInputSchema,
  output: RaceOpponentActionsOutputSchema,
  model: 'claude-sonnet-4-6',
  prompt: RACE_OPPONENT_ACTIONS_PROMPT,
  // The manifest's scope.data_required_unless. A run that read no warehouse data
  // may not submit cards claiming district numbers unless it declares one of
  // these, which is exactly the skip-Databricks degrade path.
  dataRequiredUnless: {
    field: 'haystaq_status',
    values: ['no_district', 'no_coverage'],
  },
  tools: {
    queryDatabricks: databricksTool({
      tables: [ACTIONS_TABLE],
      maxRows: ACTIONS_MAX_ROWS,
      dimensions: ACTIONS_DIMENSIONS,
      minCellSize: ACTIONS_MIN_CELL_SIZE,
      scope: actionsDatabricksScope,
    }),
  },
  // The actions persist, shared with the PMF Engine's result consumer. Resolved
  // lazily for the same import cycle the other two chain agents avoid that way.
  onArtifact: async (output, run, context) => {
    const { RaceOpponentPersistService } =
      await import('../services/raceOpponentPersist.service.js')
    await context
      .get(RaceOpponentPersistService)
      .onActionsArtifact({ runId: run.runId, artifact: output })
  },
  // Same release as the summary link: a fresh summary that landed while this
  // actions run was in flight still needs its cards regenerated.
  onFailure: async (run, context) => {
    const { RaceOpponentPersistService } =
      await import('../services/raceOpponentPersist.service.js')
    await context
      .get(RaceOpponentPersistService)
      .onActionsFailure({ runId: run.runId })
  },
})
