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
  // Optional only to survive a deploy-ordering window: gp-api validates the
  // election-api response against this schema, and a given gp-api can call an
  // election-api still running older code that predates these fields (notably a
  // PR preview, whose gp-api targets the dev election-api until this PR merges
  // and dev redeploys). election-api populates them from Race.isPrimary/isRunoff
  // via the positionId join — this just tolerates the environment that lags.
  isPrimary: z.boolean().nullish(),
  isRunoff: z.boolean().nullish(),
  city: z.string().nullable().optional(),
  district: z.string().nullable().optional(),
})

export const RaceListItemArraySchema = z.array(RaceListItemSchema)
export type RaceListItem = z.infer<typeof RaceListItemSchema>
