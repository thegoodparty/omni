import { z } from 'zod'
import { PeopleFiltersSchema } from './PeopleFilters.schema'

// people-api's POST /v1/people/overlap-count (ENG-10840): the wizard's
// in-progress selection AND'd with the union of the org's saved lists — each
// saved set built independently (identical to the count path's
// buildVoterFiltersSql) and OR-joined server-side, so a voter in several
// saved lists counts once. gp-api resolves each set's
// activity-condition/support-status parts to a person-id set before this
// call, exactly as the count path does, so `filters` and every
// `savedFilterSets` entry are already flat PeopleFilters — this file owns
// only the wire shape (mirrors PeopleFilters.schema.ts's producer/consumer
// split).
export const MAX_OVERLAP_SAVED_FILTER_SETS = 25

export const PeopleOverlapCountRequestSchema = z.object({
  districtId: z.guid(),
  filters: PeopleFiltersSchema.optional(),
  search: z.string().optional(),
  // Capped at the org's most-recently-saved lists; gp-api truncates beyond
  // that and logs a warning (never a silent drop) — this bound is the
  // wire-level enforcement of that same cap.
  savedFilterSets: z
    .array(PeopleFiltersSchema)
    .max(MAX_OVERLAP_SAVED_FILTER_SETS),
})
export type PeopleOverlapCountRequest = z.infer<
  typeof PeopleOverlapCountRequestSchema
>

// `fenced` mirrors the count/aggregates paths: true when people-api's
// statement-timeout guard floored `count` at FENCE_LIMIT rather than
// completing the exact overlap.
export const PeopleOverlapCountResponseSchema = z.object({
  count: z.number().int().min(0),
  fenced: z.boolean(),
})
export type PeopleOverlapCountResponse = z.infer<
  typeof PeopleOverlapCountResponseSchema
>
