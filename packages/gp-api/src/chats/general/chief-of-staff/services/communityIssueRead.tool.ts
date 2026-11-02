import { NotFoundException } from '@nestjs/common'
import { z } from 'zod'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import type {
  CommunityIssueDetail,
  CommunityIssueReadPort,
  CommunityIssueSummary,
} from './communityIssueRead.port'

const readCommunityIssueInputSchema = z.object({
  id: z.string().min(1).optional(),
})

export const buildReadCommunityIssuesTool = (deps: {
  port: CommunityIssueReadPort
  organizationSlug: string
  electedOfficeId: string
}): LlmStreamTool<typeof readCommunityIssueInputSchema> => ({
  description:
    "Without an id, lists the office's community issues: id, list " +
    '(top_community or trending), title, summary, category, rank, and ' +
    'whether it is already a priority. With an id from that list, or the ' +
    'anchored issue, fetches the full detail of that issue: category, rank, ' +
    'summary, detail content, and related meeting briefings. Never pass an ' +
    'id you were not given.',
  inputSchema: readCommunityIssueInputSchema,
  execute: async ({
    id,
  }): Promise<
    | { issues: CommunityIssueSummary[] }
    | CommunityIssueDetail
    | { error: string }
  > => {
    if (id === undefined) {
      return {
        issues: await deps.port.list(
          deps.organizationSlug,
          deps.electedOfficeId,
        ),
      }
    }
    try {
      return await deps.port.getDetail(
        id,
        deps.organizationSlug,
        deps.electedOfficeId,
      )
    } catch (error) {
      if (error instanceof NotFoundException) {
        return {
          error:
            'No community issue with that id. Call read_community_issues without an id to list them.',
        }
      }
      throw error
    }
  },
})
