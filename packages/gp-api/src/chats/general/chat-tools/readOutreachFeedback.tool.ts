import { z } from 'zod'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import {
  OutreachFeedback,
  PooledTheme,
  PriorityFlowOutreachService,
} from '../priority-flow/services/priorityFlowOutreach.service'

const readOutreachFeedbackInput = z.object({
  outreachId: z
    .number()
    .int()
    .optional()
    .describe('One send, from read_past_outreach. Omit for every send.'),
})

export const buildReadOutreachFeedbackTool = (deps: {
  outreach: PriorityFlowOutreachService
  priorityId: string | null
  organizationSlug: string
  // Behind serve-citizen-panels the priority flow passes its read. Before a
  // good read the words and themes stay out of the result, because a model
  // handed them lists them whatever its prompt says.
  goodRead?: boolean
}): LlmStreamTool<typeof readOutreachFeedbackInput> =>
  deps.goodRead === false
    ? {
        description:
          'Read how far each send for this priority has got: who it went ' +
          'to, when, and how many people answered. There is no good read ' +
          'yet, so it gives no replies, notes or themes, and you share none: ' +
          'name the status and the groups to hear from next instead.',
        inputSchema: readOutreachFeedbackInput,
        execute: async ({ outreachId }): Promise<HeldBackFeedback> => {
          const sends = await deps.outreach.feedbackFor(deps.organizationSlug, {
            priorityId: deps.priorityId,
            outreachId,
          })
          return {
            heldBack: HELD_BACK_NOTE,
            sends: sends.map(
              ({ outreachId, audience, channel, sentOn, heardFrom }) => ({
                outreachId,
                audience,
                channel,
                sentOn,
                heardFrom,
              }),
            ),
          }
        },
      }
    : readEverything(deps)

export const HELD_BACK_NOTE =
  'No good read yet: what people said stays out until every group is heard.'

export interface HeldBackFeedback {
  heldBack: string
  sends: Pick<
    OutreachFeedback,
    'outreachId' | 'audience' | 'channel' | 'sentOn' | 'heardFrom'
  >[]
}

const readEverything = (deps: {
  outreach: PriorityFlowOutreachService
  priorityId: string | null
  organizationSlug: string
}): LlmStreamTool<typeof readOutreachFeedbackInput> => ({
  description:
    'Read what came back from the office’s sends in people’s own words: ' +
    'each text reply (opt-outs left out), each door or call note with the ' +
    'issues and stances pulled from it, and the themes the latest summary ' +
    'found. This is where door knocking and phone banking results are; ' +
    'read_past_outreach counts text replies only. ' +
    (deps.priorityId === null
      ? 'Without an outreachId it reads the office’s most recent sends, ' +
        'every walk, list and text together. When the official names one, ' +
        'or asks about one channel, find each outreachId by name or ' +
        'channel with read_past_outreach and read only those. '
      : 'Without an outreachId it reads every send for this priority, and ' +
        'priorityThemes are the themes across all of them, texts, calls ' +
        'and doors together; lead with those. ') +
    'Call it before you say anything about what constituents said, and ' +
    'never ask the official how many replied or what people said: read it ' +
    'here. Quote people’s words when they make the point, and say how many ' +
    'people a theme covers. A door or call note that is not confirmed is a ' +
    'volunteer’s account the official has not reviewed yet.',
  inputSchema: readOutreachFeedbackInput,
  execute: async ({
    outreachId,
  }): Promise<{
    priorityThemes: PooledTheme[]
    sends: OutreachFeedback[]
  }> => ({
    priorityThemes:
      deps.priorityId === null
        ? []
        : await deps.outreach.pooledThemes(
            deps.organizationSlug,
            deps.priorityId,
          ),
    sends: await deps.outreach.feedbackFor(deps.organizationSlug, {
      priorityId: deps.priorityId,
      outreachId,
    }),
  }),
})

// A campaign has no priorities and no good-read hold, so its read is the
// campaign's door and call notes with their themes.
export const buildCampaignManagerReadOutreachFeedbackTool = (deps: {
  outreach: PriorityFlowOutreachService
  campaignId: number
}): LlmStreamTool<typeof readOutreachFeedbackInput> => ({
  description:
    'Read what voters told the campaign at the door or on a call: each ' +
    'note the canvasser or caller took, with the issues and stances pulled ' +
    'from it, and the themes the latest summary found. This is where door ' +
    'knocking and phone banking results are; read_past_outreach counts ' +
    "text replies only. Without an outreachId it reads the campaign's most " +
    'recent door knocking and phone banking, every walk and list together. ' +
    'When the candidate names one, or asks about one channel, find each ' +
    'outreachId by name or channel with read_past_outreach and read only ' +
    'those. Texts are not here: their replies come back as counts, never ' +
    'words. Call it before you say anything about what voters said, ' +
    'and never ask the candidate what voters said: read it here. Quote ' +
    'voters’ words when they make the point, and say how many voters a ' +
    'theme covers. A note that is not confirmed is a volunteer’s account ' +
    'the candidate has not reviewed yet.',
  inputSchema: readOutreachFeedbackInput,
  execute: async ({ outreachId }): Promise<{ sends: OutreachFeedback[] }> => ({
    sends: await deps.outreach.feedbackForCampaign(deps.campaignId, outreachId),
  }),
})
