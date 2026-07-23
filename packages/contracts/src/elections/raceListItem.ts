import { z } from 'zod'

export const RaceListItemSchema = z.object({
  id: z.string(),
  brPositionId: z.string(),
  position: z.object({
    name: z.string(),
    level: z.string(),
    state: z.string(),
    normalizedPosition: z.object({ name: z.string() }).optional(),
  }),
  election: z.object({
    electionDay: z.string(),
  }),
  // Optional so gp-api tolerates an election-api that predates these fields
  // (e.g. a PR preview whose gp-api points at the not-yet-updated dev
  // election-api). Populated once election-api ships the positionId join.
  isPrimary: z.boolean().nullish(),
  isRunoff: z.boolean().nullish(),
  city: z.string().nullable().optional(),
  district: z.string().nullable().optional(),
})

export const RaceListItemArraySchema = z.array(RaceListItemSchema)
export type RaceListItem = z.infer<typeof RaceListItemSchema>
