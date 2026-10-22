import { z } from 'zod'
import { OutreachTypeSchema } from '@goodparty_org/contracts'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import {
  PastOutreachRow,
  PriorityFlowOutreachService,
} from '../priority-flow/services/priorityFlowOutreach.service'

const readPastOutreachInput = z.object({
  channel: OutreachTypeSchema.optional().describe(
    'Limit to one channel. Omit to see every channel.',
  ),
})

export interface ReadPastOutreachOutput {
  priority: PastOutreachRow[]
  office: PastOutreachRow[]
}

export const buildReadPastOutreachTool = (deps: {
  outreach: PriorityFlowOutreachService
  priorityId: string | null
  organizationSlug: string
  // The office's local day (yyyy-MM-dd), the day the prompt's date line shows.
  today: string
}): LlmStreamTool<typeof readPastOutreachInput> => ({
  description:
    'Read what has already gone out from the office: audience, how many ' +
    'people, channel, status, when it is scheduled for and when it went, ' +
    'and how many replied. sentOn is null until a send has gone out; one ' +
    'with a scheduledFor day and no sentOn has not gone out yet. When the ' +
    "conversation is about one priority, that priority's own sends come " +
    "back under priority and the office's other recent sends under office, " +
    'for comparison. Otherwise priority is empty and office holds every ' +
    'recent send. Call it before proposing outreach so you can say what ' +
    'came back last time instead of guessing, and quote the numbers you ' +
    'get back rather than describing them vaguely.',
  inputSchema: readPastOutreachInput,
  execute: async ({ channel }): Promise<ReadPastOutreachOutput> => ({
    priority:
      deps.priorityId === null
        ? []
        : await deps.outreach.forPriority(deps.priorityId, deps.today, channel),
    office: await deps.outreach.forOffice(
      deps.organizationSlug,
      deps.priorityId,
      deps.today,
      channel,
    ),
  }),
})

// A campaign has no priorities, so its read is one list of the candidate's
// recent sends rather than the priority/office split above.
export const buildCampaignManagerReadPastOutreachTool = (deps: {
  outreach: PriorityFlowOutreachService
  campaignId: number
  today: string
}): LlmStreamTool<typeof readPastOutreachInput> => ({
  description:
    "Read the campaign's recent outreach: audience, how many voters, " +
    'channel, status, when it is scheduled for and when it went, and how ' +
    'many replied. sentOn is null until a send has gone out. Call it before proposing ' +
    'a text so you can say what came back last time instead of guessing, ' +
    'and quote the numbers you get back rather than describing them ' +
    'vaguely.',
  inputSchema: readPastOutreachInput,
  execute: async ({ channel }): Promise<{ sends: PastOutreachRow[] }> => ({
    sends: await deps.outreach.forCampaign(
      deps.campaignId,
      deps.today,
      channel,
    ),
  }),
})
