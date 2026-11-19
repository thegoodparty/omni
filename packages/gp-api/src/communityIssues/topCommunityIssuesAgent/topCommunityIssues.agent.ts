import type { z } from 'zod'
import { defineAgent } from '@/agents/defineAgent'
import { checkLink } from '@/agents/tools/checkLink'
import { fetchPage } from '@/agents/tools/fetchPage'
import { renderPage } from '@/agents/tools/renderPage'
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

const L2_COLUMN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

// The run's own input, read by run id, never anything the model sends. The
// dispatcher builds it from the org's resolveServeContext and its resolved
// people mart, so in production it is the org's own scope and table; on a judge
// run, where every case shares one fixture org, it is the case's own district.
// A run with no valid input refuses every query.
const runInput = async (
  ctx: ToolContext,
): Promise<z.infer<typeof TopCommunityIssuesInputSchema> | null> => {
  const run = await ctx.get(PrismaService).agentRun.findUnique({
    where: { id: ctx.runId },
    select: { input: true, organizationSlug: true },
  })
  if (!run || run.organizationSlug !== ctx.organizationSlug) return null
  const input = TopCommunityIssuesInputSchema.safeParse(run.input)
  return input.success ? input.data : null
}

// A half L2 pair, or no state, refuses every query.
export const topCommunityIssuesDatabricksScope = async (
  ctx: ToolContext,
): Promise<DatabricksScope | null> => {
  const input = await runInput(ctx)
  if (!input) return null
  const { state, l2DistrictType, l2DistrictName } = input
  if (Boolean(l2DistrictType) !== Boolean(l2DistrictName)) return null
  const district =
    l2DistrictType && l2DistrictName && L2_COLUMN_NAME.test(l2DistrictType)
      ? { column: l2DistrictType, value: l2DistrictName }
      : null
  return { state, district }
}

// The one people mart this run may read: whichever PeopleDatasetService
// resolved for its org at dispatch. An input naming anything else (or none)
// refuses every query, so the grant never widens to the other mart.
export const topCommunityIssuesDatabricksTables = async (
  ctx: ToolContext,
): Promise<string[]> => {
  const input = await runInput(ctx)
  return input ? [input.peopleTable] : []
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
    renderPage,
    queryDatabricks: databricksTool({
      tables: topCommunityIssuesDatabricksTables,
      maxRows: 50_000,
      // The lean query is a pure aggregate over the district, and the only
      // column it slices by is the activity flag. The district and state come
      // from the run's scope, so they need no entry here.
      dimensions: ['Active'],
      minCellSize: 100,
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
