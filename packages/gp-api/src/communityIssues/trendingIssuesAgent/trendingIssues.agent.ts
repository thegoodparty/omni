import { defineAgent } from '@/agents/defineAgent'
import { checkLink } from '@/agents/tools/checkLink'
import { fetchPage } from '@/agents/tools/fetchPage'
import { renderPage } from '@/agents/tools/renderPage'
import { webSearch } from '@/agents/tools/webSearch'
import { CommunityIssueService } from '../services/communityIssue.service'
import { getCommunityIssues } from './getCommunityIssues.tool'
import { TRENDING_ISSUES_PROMPT } from './trendingIssues.prompt'
import {
  trendingIssuesArtifact,
  TrendingIssuesInputSchema,
  TrendingIssuesOutputSchema,
} from './trendingIssues.schema'

// The trending_issues experiment on gp-api's own agents. The manifest's
// model is "sonnet" with thinking off.
export const trendingIssuesAgent = defineAgent({
  input: TrendingIssuesInputSchema,
  output: TrendingIssuesOutputSchema,
  model: 'claude-sonnet-4-6',
  prompt: TRENDING_ISSUES_PROMPT,
  tools: { getCommunityIssues, webSearch, checkLink, fetchPage, renderPage },
  onArtifact: (output, run, { get }) =>
    get(CommunityIssueService).ingestAgentArtifact(
      { runId: run.runId, organizationSlug: run.input.organizationSlug },
      trendingIssuesArtifact(output, {
        runId: run.runId,
        organizationSlug: run.input.organizationSlug,
      }),
    ),
})
