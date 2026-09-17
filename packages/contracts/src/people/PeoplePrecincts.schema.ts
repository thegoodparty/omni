import { z } from 'zod'

// One selectable precinct in a district, as returned by
// GET /v1/contacts/precincts. `precinct` is empty for the "Unknown" bucket —
// the voters in that county with no precinct on file (0.7% nationally, and
// every one of New Hampshire's 1,086,506 voters). It is a real, selectable
// option, not a null to be filtered out client-side.
export const PrecinctOptionSchema = z.object({
  county: z.string(),
  precinct: z.string(),
  voters: z.number().int().nonnegative(),
})
export type PrecinctOption = z.infer<typeof PrecinctOptionSchema>

// `truncated` is a safety valve, not a working limit: the largest ICP
// district in the country is Kings County CA at 579 precincts and p75 is
// 13-15, so it should effectively never be true for a real customer. It can
// be for a non-ICP org on a very large county, and the UI says so rather than
// pretending the list is complete.
export const PeoplePrecinctsResponseSchema = z.object({
  options: z.array(PrecinctOptionSchema),
  truncated: z.boolean(),
})
export type PeoplePrecinctsResponse = z.infer<
  typeof PeoplePrecinctsResponseSchema
>
