import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

const GetVoterDensitySchema = z.object({
  personId: z.guid('personId must be a valid UUID'),
})

export class GetVoterDensityDto extends createZodDto(GetVoterDensitySchema) {}

// One precomputed heat-map cell: an H3 cell centroid + its voter count. This is
// the ONLY geometry that leaves people-api — never a voter/household location.
const VoterDensityCellSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  count: z.number(),
})

// Public response for the voter-density heat map. Deliberately narrower than
// the people-api payload: the public page needs only coverage (to decide
// whether to render) and the centroid cells. `coverage` is null when upstream
// has no meta row for the district/resolution.
export const VoterDensityResponseSchema = z.object({
  coverage: z.number().nullable(),
  cells: z.array(VoterDensityCellSchema),
})

export type VoterDensityResponse = z.infer<typeof VoterDensityResponseSchema>
export type VoterDensityCell = z.infer<typeof VoterDensityCellSchema>
