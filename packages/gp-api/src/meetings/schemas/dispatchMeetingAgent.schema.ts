import { z } from 'zod'
import {
  BriefingDispatchPreviewSchema,
  DispatchMeetingAgentRequestSchema,
} from '@goodparty_org/contracts'

export const DispatchMeetingAgentSchema = DispatchMeetingAgentRequestSchema

export type DispatchMeetingAgentDto = z.infer<typeof DispatchMeetingAgentSchema>

export const DispatchPreviewQuerySchema = z.object({
  electedOfficeId: z.string().min(1),
})

export type DispatchPreviewQuery = z.infer<typeof DispatchPreviewQuerySchema>

export { BriefingDispatchPreviewSchema }

export const BriefingDispatchOutcomeSchema = z.object({
  dispatched: z.boolean(),
  inFlight: z.boolean(),
  meetingDate: z.string().nullable(),
})
