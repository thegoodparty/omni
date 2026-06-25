import { z } from 'zod'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import type {
  CommunityIssueDetail,
  CommunityIssueReadPort,
} from './communityIssueRead.port'

const readCommunityIssueInputSchema = z.object({
  id: z.string().min(1),
})

export const buildReadCommunityIssuesTool = (deps: {
  port: CommunityIssueReadPort
  organizationSlug: string
  electedOfficeId: string
}): LlmStreamTool<typeof readCommunityIssueInputSchema> => ({
  description:
    'Fetch full detail for a community issue by id. Returns the category, ' +
    'rank, summary, detail content, and related meeting briefings. ' +
    'Use when the user asks to know more about a specific issue.',
  inputSchema: readCommunityIssueInputSchema,
  execute: async ({ id }): Promise<CommunityIssueDetail> =>
    deps.port.getDetail(id, deps.organizationSlug, deps.electedOfficeId),
})
