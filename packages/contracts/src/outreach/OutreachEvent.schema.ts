import { z } from 'zod'

export const OUTREACH_EVENT_LOCATION_MAX_LENGTH = 200

const EventDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Invalid date')

/**
 * When and where an invited event happens, as the sender entered it. The draft
 * endpoints write these into an event invite as given. Local to the event:
 * the date is a calendar day and the time a wall-clock start, with no zone.
 */
export const OutreachEventDetailsSchema = z.object({
  /** YYYY-MM-DD. */
  date: EventDateSchema,
  /** 24-hour HH:MM start time. */
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  location: z.string().trim().min(1).max(OUTREACH_EVENT_LOCATION_MAX_LENGTH),
})
export type OutreachEventDetails = z.infer<typeof OutreachEventDetailsSchema>

/**
 * What an agent knows about the event it proposes an invite to. Any part may
 * be missing; the flow asks the official for the rest before drafting.
 */
export const ProposalEventSchema = OutreachEventDetailsSchema.partial()
export type ProposalEvent = z.infer<typeof ProposalEventSchema>
