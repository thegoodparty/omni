import { PastOutreachRefSchema } from '@goodparty_org/contracts'
import type { LlmStreamTool } from '@/llm/services/llm.service'

export const buildPresentPastOutreachTool = (): LlmStreamTool<
  typeof PastOutreachRefSchema
> => ({
  description:
    'Show one to five past sends the official should look at, by their ' +
    'outreach ids from read_past_outreach. Use it when what came back last ' +
    'time is the point you are making. The note is your one-line read of ' +
    'why these matter here.',
  inputSchema: PastOutreachRefSchema,
  execute: () => ({ presented: true }),
})

export const buildCampaignManagerPresentPastOutreachTool = (): LlmStreamTool<
  typeof PastOutreachRefSchema
> => ({
  description:
    'Show one to five past sends the candidate should look at, by their ' +
    'outreach ids from read_past_outreach. Use it when what came back last ' +
    'time is the point you are making. The note is your one-line read of ' +
    'why these matter here.',
  inputSchema: PastOutreachRefSchema,
  execute: () => ({ presented: true }),
})
