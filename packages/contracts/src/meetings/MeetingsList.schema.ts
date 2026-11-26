import { z } from 'zod'

const MEETING_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MEETING_TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

// Date.parse rolls February 31 over to March, so the day has to survive the
// round trip.
const isRealDate = (value: string): boolean => {
  const parsed = Date.parse(`${value}T00:00:00Z`)
  return (
    !Number.isNaN(parsed) && new Date(parsed).toISOString().startsWith(value)
  )
}

// `official` is the first meeting the official gave in Serve onboarding when
// the schedule's was wrong. Every other row is `schedule`: what the product
// worked out from the meeting schedule, a briefing or a pasted agenda.
export const MEETING_SOURCE_VALUES = ['schedule', 'official'] as const
export const MeetingSourceSchema = z.enum(MEETING_SOURCE_VALUES)
export type MeetingSource = z.infer<typeof MeetingSourceSchema>

export const USER_AGENDA_STATUS_VALUES = [
  'processing',
  'failed',
  'rejected',
  'completed',
  'unknown',
] as const
export const UserAgendaStatusSchema = z.enum(USER_AGENDA_STATUS_VALUES)
export type UserAgendaStatus = z.infer<typeof UserAgendaStatusSchema>

// One row of `GET /v1/meetings`. `meetingDate` is yyyy-MM-dd and
// `meetingTime` is HH:mm, both on the meeting's own clock
// (`meetingTimezone`, IANA). A row that exists only because the official
// pasted an agenda for a date nothing else knows has '' for the time, zone,
// name and location and 0 for the duration.
export const MeetingListItemSchema = z.object({
  meetingDate: z.string(),
  meetingTime: z.string(),
  meetingTimezone: z.string(),
  durationMinutes: z.number(),
  meetingName: z.string(),
  // One line of free text as the schedule or the agenda states it ("City
  // Hall Council Chambers, 200 Main St"). Nothing holds it in parts.
  location: z.string(),
  hasBriefing: z.boolean(),
  userAgendaStatus: UserAgendaStatusSchema.nullable(),
  // Why gp-api declined to publish the user's agenda run, when
  // userAgendaStatus is 'rejected'. A machine string; null otherwise.
  userAgendaReason: z.string().nullable(),
  source: MeetingSourceSchema,
})
export type MeetingListItem = z.infer<typeof MeetingListItemSchema>

export const MeetingsListResponseSchema = z.object({
  scheduleKnown: z.boolean(),
  meetings: z.array(MeetingListItemSchema),
})
export type MeetingsListResponse = z.infer<typeof MeetingsListResponseSchema>

// `PUT /v1/meetings/first-meeting`: the day and time of the official's first
// meeting, on the meeting's own clock. Also the response.
export const StatedFirstMeetingSchema = z.object({
  meetingDate: z
    .string()
    .regex(MEETING_DATE_RE, 'meetingDate must be yyyy-MM-dd')
    .refine(isRealDate, { message: 'meetingDate must be a real date' }),
  meetingTime: z.string().regex(MEETING_TIME_RE, 'meetingTime must be HH:mm'),
})
export type StatedFirstMeeting = z.infer<typeof StatedFirstMeetingSchema>
