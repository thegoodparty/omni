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
}): LlmStreamTool<typeof readOutreachFeedbackInput> => ({
  description:
    'Read what came back from the office’s sends in people’s own words: ' +
    'each text reply (opt-outs left out), each door or call note with the ' +
    'issues and stances pulled from it, and the themes the latest summary ' +
    'found. ' +
    (deps.priorityId === null
      ? 'Without an outreachId it reads the office’s most recent sends. '
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
