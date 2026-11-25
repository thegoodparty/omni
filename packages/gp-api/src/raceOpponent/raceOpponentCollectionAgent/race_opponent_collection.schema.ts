import { z } from 'zod'

// The manifest's input_schema, in gp-api's names, plus the run's owner.
// `race_context` is the one object the manifest leaves open
// (`additionalProperties: true`): gp-api hydrates it from the campaign and the
// election database, and only the discovery hints below are read from it.
export const RaceContextSchema = z
  .object({
    officeName: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    electionDate: z.string().nullable().optional(),
  })
  .loose()
export type RaceContext = z.infer<typeof RaceContextSchema>

export const RaceOpponentCollectionInputSchema = z.strictObject({
  organizationSlug: z.string().min(1),
  opponents: z
    .array(
      z.strictObject({
        fullName: z.string().min(1),
        ballotpediaUrl: z.string().nullable().optional(),
        websiteUrl: z.string().nullable().optional(),
      }),
    )
    .min(1),
  raceContext: RaceContextSchema,
})
export type RaceOpponentCollectionInput = z.infer<
  typeof RaceOpponentCollectionInputSchema
>

// The manifest's output_schema, unchanged: `race_opponent.content` and
// `race_opponent.source_url` are written from it, so a gp-api run publishes the
// artifact the PMF Engine does.
export const RaceOpponentCollectionItemSchema = z.strictObject({
  opponent_name: z.string().min(1),
  source_type: z.enum(['ballotpedia', 'opponent_website']),
  source_url: z.string().regex(/^https?:\/\//),
  content: z.strictObject({ text: z.string().min(1) }),
})
export type RaceOpponentCollectionItem = z.infer<
  typeof RaceOpponentCollectionItemSchema
>

// An empty `items` array is a valid artifact: an opponent with no findable
// Ballotpedia page or website is the expected down-ballot case, and that "no
// web footprint" finding is what this stage exists to surface.
export const RaceOpponentCollectionOutputSchema = z.strictObject({
  generated_at: z.string().min(1),
  items: z.array(RaceOpponentCollectionItemSchema),
})
export type RaceOpponentCollectionOutput = z.infer<
  typeof RaceOpponentCollectionOutputSchema
>
