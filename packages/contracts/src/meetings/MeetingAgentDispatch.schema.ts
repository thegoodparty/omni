import { z } from 'zod'

export const MeetingAgentDispatchKindSchema = z.enum(['schedule', 'briefing'])

export type MeetingAgentDispatchKind = z.infer<
  typeof MeetingAgentDispatchKindSchema
>

export const DispatchMeetingAgentRequestSchema = z.object({
  electedOfficeId: z.string().min(1),
  kind: MeetingAgentDispatchKindSchema,
  useImminenceGate: z.boolean().optional(),
})

export type DispatchMeetingAgentRequest = z.infer<
  typeof DispatchMeetingAgentRequestSchema
>

export const DispatchMeetingAgentResultSchema = z.object({
  dispatched: z.boolean(),
  kind: MeetingAgentDispatchKindSchema,
})

export type DispatchMeetingAgentResult = z.infer<
  typeof DispatchMeetingAgentResultSchema
>

// Read-only projection of what dispatchManual would do for a briefing.
// Dates are yyyy-MM-dd. `imminentMeetingDate` is the RRULE projection inside
// the imminence window; `nextMeetingDate` uses the wider manual-dispatch
// window, so a null here means even an override would find no meeting.
export const BriefingDispatchPreviewSchema = z.object({
  contextOk: z.boolean(),
  isServeIcp: z.boolean().nullable(),
  scheduleKnown: z.boolean(),
  nextMeetingDate: z.string().nullable(),
  imminentMeetingDate: z.string().nullable(),
  coveredByBriefingDate: z.string().nullable(),
  gateWouldDispatch: z.boolean(),
  overrideWouldDispatch: z.boolean(),
})

export type BriefingDispatchPreview = z.infer<
  typeof BriefingDispatchPreviewSchema
>
