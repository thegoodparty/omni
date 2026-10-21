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
}): LlmStreamTool<typeof readPastOutreachInput> => ({
  description:
    'Read what has already gone out from the office: audience, how many ' +
    'people, channel, when it went, and how many replied. When the ' +
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
        : await deps.outreach.forPriority(deps.priorityId, channel),
    office: await deps.outreach.forOffice(
      deps.organizationSlug,
      deps.priorityId,
      channel,
    ),
  }),
})

// A campaign has no priorities, so its read is one list of the candidate's
// recent sends rather than the priority/office split above.
export const buildCampaignManagerReadPastOutreachTool = (deps: {
  outreach: PriorityFlowOutreachService
  campaignId: number
}): LlmStreamTool<typeof readPastOutreachInput> => ({
  description:
    "Read the campaign's recent outreach: audience, how many voters, " +
    'channel, when it went, and how many replied. Call it before proposing ' +
    'a text so you can say what came back last time instead of guessing, ' +
    'and quote the numbers you get back rather than describing them ' +
    'vaguely.',
  inputSchema: readPastOutreachInput,
  execute: async ({ channel }): Promise<{ sends: PastOutreachRow[] }> => ({
    sends: await deps.outreach.forCampaign(deps.campaignId, channel),
  }),
})
