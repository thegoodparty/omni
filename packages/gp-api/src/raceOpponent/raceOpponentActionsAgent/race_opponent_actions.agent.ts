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

// Every `hs_*` column the instruction's inline catalog names, which is the
// complete set this agent may slice. The tool requires each one a query filters
// or groups by to be declared here, so the threshold count is written as
// `COUNT(*)` over a `WHERE ... AND CAST(hs_x AS DOUBLE) >= 50` (the tool refuses
// a CASE inside an aggregate), and this list is what makes that WHERE legal. It
// is the manifest's own catalog, so nothing outside the instruction becomes
// reachable.
const HAYSTAQ_COLUMNS = [
  'hs_affordable_housing_gov_has_role',
  'hs_affordable_housing_gov_no_role',
  'hs_gentrification_support',
  'hs_gentrification_oppose',
  'hs_tax_cuts_support',
  'hs_tax_cuts_oppose',
  'hs_gas_tax_support',
  'hs_gas_tax_oppose',
  'hs_ideology_fiscal_conservative',
  'hs_ideology_fiscal_liberal',
  'hs_school_choice_support',
  'hs_school_choice_oppose',
  'hs_school_funding_more',
  'hs_school_funding_less',
  'hs_charter_schools_support',
  'hs_charter_schools_oppose',
  'hs_teachers_union_positive',
  'hs_teachers_union_negative',
  'hs_medicaid_expansion_support',
  'hs_medicaid_expansion_oppose',
  'hs_medicare_for_all_support',
  'hs_medicare_for_all_oppose',
  'hs_obamacare_aca_expand',
  'hs_obamacare_aca_protect',
  'hs_obamacare_aca_oppose',
  'hs_climate_change_believer',
  'hs_climate_change_nonbeliever',
  'hs_electric_vehicle_likely_buyer',
  'hs_electric_vehicle_not_likely',
  'hs_solar_panel_buyer_yes',
  'hs_solar_panel_buyer_no',
  'hs_pipeline_fracking_support',
  'hs_pipeline_fracking_oppose',
  'hs_green_new_deal_support',
  'hs_green_new_deal_oppose',
  'hs_mass_deportations_support',
  'hs_mass_deportations_oppose',
  'hs_mexican_wall_support',
  'hs_mexican_wall_oppose',
  'hs_illegal_imm_process_unfair',
  'hs_illegal_imm_undesirable',
  'hs_violent_crime_worried',
  'hs_violent_crime_not_worried',
  'hs_gun_control_support',
  'hs_gun_control_oppose',
  'hs_police_trust_yes',
  'hs_police_trust_no',
  'hs_death_penalty_support',
  'hs_death_penalty_oppose',
  'hs_abortion_pro_choice',
  'hs_abortion_pro_life',
  'hs_same_sex_marriage_support',
  'hs_same_sex_marriage_oppose',
  'hs_trans_athlete_yes',
  'hs_trans_athlete_no',
  'hs_dei_support',
  'hs_dei_oppose',
  'hs_religion_important',
  'hs_religion_not_important',
  'hs_regulations_too_harsh',
  'hs_regulations_good',
  'hs_capitalism_believe_sound',
  'hs_capitalism_believe_flawed',
  'hs_unions_beneficial',
  'hs_unions_not_beneficial',
  'hs_income_inequality_serious',
  'hs_income_inequality_no_issue',
  'hs_infrastructure_funding_fund_more',
  'hs_infrastructure_funding_enough_spent',
]

// The run's own jurisdiction, read from its stored input rather than from the
// model or the org: the dispatcher builds those params from
// DistrictResolverService, and a judge run's case carries its own district. A
// run with no state refuses every query, and one with no district (or half an
// L2 pair) is scoped to its state alone, which is the manifest's own degrade
// path (`haystaq_status: no_district` is the agent's choice, not this tool's).
const actionsDatabricksScope = async (
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
  if (Boolean(l2DistrictType) !== Boolean(l2DistrictName)) return { state }
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
      dimensions: ['Active', ...HAYSTAQ_COLUMNS],
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
})
