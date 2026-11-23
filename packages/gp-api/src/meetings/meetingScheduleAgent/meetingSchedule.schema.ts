import type { MeetingSchedule as MeetingScheduleContract } from '@/generated/agent-job-contracts'
import { z } from 'zod'

// The manifest's input_schema, in gp-api's names, plus the run's date.
// `elected_office_id` is left out: the office that owns the location hint and
// the chained briefing is the run's organization's, and
// ElectedOffice.organizationSlug is unique.
export const MeetingScheduleInputSchema = z.object({
  organizationSlug: z.string().min(1),
  state: z.string().regex(/^[A-Z]{2}$/),
  office: z.string().min(1).max(200),
  knownScheduleLocation: z.string().min(1).max(2000).optional(),
  today: z.iso.date(),
})
export type MeetingScheduleInput = z.infer<typeof MeetingScheduleInputSchema>

const SourceSchema = z.strictObject({
  url: z
    .string()
    .regex(/^https?:\/\//)
    .max(2048),
  note: z.string().min(1).max(500),
})

// The manifest's output_schema, which the artifact's readers already take
// (src/generated/agent-job-contracts.ts). `generated_at` is a plain string
// rather than a datetime because nothing reads it; the prompt has the model
// write the run's `today` into it.
const MeetingScheduleFoundSchema = z.strictObject({
  generated_at: z.string().min(1),
  status: z.literal('found'),
  meeting_name: z.string().min(1).max(200),
  location: z.string().min(1).max(300),
  rrule: z
    .string()
    .min(1)
    .max(500)
    .regex(/^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/),
  human: z.string().min(1).max(500),
  time: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),
  timezone: z
    .string()
    .max(64)
    .regex(/^[A-Za-z]+(\/[A-Za-z_]+)+$/),
  duration_minutes: z.int().min(15).max(1440),
  sources: z.array(SourceSchema).min(1).max(20),
  discovered_schedule_location: z.string().max(2000).nullable(),
})

const MeetingScheduleNotFoundSchema = z.strictObject({
  generated_at: z.string().min(1),
  status: z.literal('not_found'),
  meeting_name: z.literal(''),
  location: z.literal(''),
  rrule: z.literal(''),
  human: z.literal(''),
  time: z.literal(''),
  timezone: z.literal(''),
  duration_minutes: z.literal(0),
  sources: z.array(SourceSchema).max(20),
  discovered_schedule_location: z.string().max(2000).nullable(),
})

export const MeetingScheduleOutputSchema = z.discriminatedUnion('status', [
  MeetingScheduleFoundSchema,
  MeetingScheduleNotFoundSchema,
])
export type MeetingScheduleOutput = z.infer<typeof MeetingScheduleOutputSchema>

// The artifact's readers take the generated contract's shape, whose `sources`
// is a 1-to-20 tuple. The schema above has already held the output to the same
// bounds, so this is where the two spellings meet and nowhere else.
export const toMeetingSchedule = (
  output: MeetingScheduleOutput,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
): MeetingScheduleContract => output as unknown as MeetingScheduleContract
