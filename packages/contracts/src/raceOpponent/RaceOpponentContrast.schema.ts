import { z } from 'zod'
import { RaceOpponentContrastStatusSchema } from '../generated/enums'

// `routing` is a free String column in Prisma, not a Prisma enum, so it is
// modeled here rather than generated. It names where a cleared contrast is
// destined: a campaign story, a texting outreach, or a mail piece.
export const RACE_OPPONENT_CONTRAST_ROUTING_VALUES = [
  'story',
  'texting',
  'mail',
] as const
export const RaceOpponentContrastRoutingSchema = z.enum(
  RACE_OPPONENT_CONTRAST_ROUTING_VALUES,
)
export type RaceOpponentContrastRouting = z.infer<
  typeof RaceOpponentContrastRoutingSchema
>

// A contrast pairs an opponent fact (with its source) against a candidate fact
// and a one-line contrast sentence, tagged by issue and routed to a channel.
// All six content fields are required and non-empty. routedStoryId /
// routedOutreachId are set once routed; findingId links back to the source
// finding (nullable: SetNull on delete).
export const RaceOpponentContrastSchema = z.object({
  id: z.number(),
  opponentFact: z.string().min(1),
  sourceUrl: z.string().min(1),
  candidateFact: z.string().min(1),
  contrastSentence: z.string().min(1),
  issueTag: z.string().min(1),
  routing: RaceOpponentContrastRoutingSchema,
  status: RaceOpponentContrastStatusSchema,
  editCount: z.number(),
  findingId: z.number().nullable(),
  routedStoryId: z.number().nullable(),
  routedOutreachId: z.number().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type RaceOpponentContrast = z.infer<typeof RaceOpponentContrastSchema>
