import { defineAgent } from '@/agents/defineAgent'
import { checkLink } from '@/agents/tools/checkLink'
import { fetchPage } from '@/agents/tools/fetchPage'
import {
  databricksTool,
  type DatabricksScope,
} from '@/agents/tools/queryDatabricks'
import type { ToolContext } from '@/agents/tools/tool'
import { webSearch } from '@/agents/tools/webSearch'
import { PrismaService } from '@/prisma/prisma.service'
import { CommunityIssueService } from '../services/communityIssue.service'
import { getCommunityIssues } from '../trendingIssuesAgent/getCommunityIssues.tool'
import { TOP_COMMUNITY_ISSUES_PROMPT } from './topCommunityIssues.prompt'
import {
  topCommunityIssuesArtifact,
  TopCommunityIssuesInputSchema,
  TopCommunityIssuesOutputSchema,
} from './topCommunityIssues.schema'

// The mart view over the manifest's
// goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq: gp-api's
// Databricks principal reads mart_gp_api only, as every other voter read does.
export const TOP_COMMUNITY_ISSUES_TABLE =
  'goodparty_data_catalog.mart_gp_api.gp_api_haystaq_issue_scores'

const L2_COLUMN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

// The scope is the run's stored input, read by run id, never anything the
// model sends. The dispatcher builds that input from the org's
// resolveServeContext, so in production it is orgDatabricksScope's answer;
// on a judge run, where every case shares one fixture org, it is the case's
// own district. A half L2 pair, or no state, refuses every query.
export const topCommunityIssuesDatabricksScope = async (
  ctx: ToolContext,
): Promise<DatabricksScope | null> => {
  const run = await ctx.get(PrismaService).agentRun.findUnique({
    where: { id: ctx.runId },
    select: { input: true, organizationSlug: true },
  })
  if (!run || run.organizationSlug !== ctx.organizationSlug) return null
  const input = TopCommunityIssuesInputSchema.safeParse(run.input)
  if (!input.success) return null
  const { state, l2DistrictType, l2DistrictName } = input.data
  if (Boolean(l2DistrictType) !== Boolean(l2DistrictName)) return null
  const district =
    l2DistrictType && l2DistrictName && L2_COLUMN_NAME.test(l2DistrictType)
      ? { column: l2DistrictType, value: l2DistrictName }
      : null
  return { state, district }
}

// The top_community_issues experiment on gp-api's own agents. The manifest's
// model is "sonnet" with thinking off.
export const topCommunityIssuesAgent = defineAgent({
  input: TopCommunityIssuesInputSchema,
  output: TopCommunityIssuesOutputSchema,
  model: 'claude-sonnet-4-6',
  prompt: TOP_COMMUNITY_ISSUES_PROMPT,
  // The manifest's scope.data_required_unless, which the PMF Engine broker
  // enforces at publish: a run that read no data may not report findings
  // unless it declares it found insufficient signal.
  dataRequiredUnless: {
    field: 'data_quality',
    values: ['insufficient_signal'],
  },
  tools: {
    getCommunityIssues,
    webSearch,
    fetchPage,
    checkLink,
    queryDatabricks: databricksTool({
      tables: [TOP_COMMUNITY_ISSUES_TABLE],
      maxRows: 50_000,
      scope: topCommunityIssuesDatabricksScope,
    }),
  },
  onArtifact: (output, run, { get }) =>
    get(CommunityIssueService).ingestAgentArtifact(
      { runId: run.runId, organizationSlug: run.input.organizationSlug },
      topCommunityIssuesArtifact(output, {
        runId: run.runId,
        organizationSlug: run.input.organizationSlug,
      }),
    ),
})
