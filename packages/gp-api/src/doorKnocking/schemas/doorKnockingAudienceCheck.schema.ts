import { z } from 'zod'
import { voterFilterBaseSchema } from '@/shared/schemas/voterFilterBase.schema'

// The same filter grammar `address-preview` takes, minus the shape — which is
// the whole point of the endpoint, so the omission is the schema's main
// statement rather than an oversight.
//
// A draft, not a saved list id. The who step asks this question in two
// situations: a saved list was picked, and a new list is being built out of
// filter pills against no row that exists yet. Taking the grammar answers
// both with one route, and keeps this endpoint resolving exactly what
// `address-preview` and the create resolve — a saved-list id would answer
// only the first and would read the row a second way.
export const DoorKnockingAudienceCheckSchema = z
  .object({
    filters: voterFilterBaseSchema,
  })
  .strict()

export type DoorKnockingAudienceCheck = z.infer<
  typeof DoorKnockingAudienceCheckSchema
>
