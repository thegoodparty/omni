import { z } from 'zod'
import { defineTool } from '@/agents/tools/tool'
import { CommunityIssueReadService } from '../services/communityIssueRead.service'

const getCommunityIssuesInput = z.object({
  list: z.enum(['top_community', 'trending']),
})

// The run's own organization's live feed, as the PMF Engine's
// GET_community_issues MCP tool reads it (GET /v1/community-issues).
export const getCommunityIssues = defineTool({
  description:
    "List the organization's current community issues on one list, with each issue's id, title, category, priority, rank and whether the official prioritized it.",
  input: getCommunityIssuesInput,
  execute: async ({ list }, ctx) => {
    const read = ctx.get(CommunityIssueReadService)
    const office = await read.client.electedOffice.findFirst({
      where: { organizationSlug: ctx.organizationSlug },
      select: { id: true },
    })
    if (!office) return { issues: [] }
    const { issues } = await read.listForOrg(
      ctx.organizationSlug,
      office.id,
      list,
    )
    return { issues }
  },
})
