import { z } from 'zod'
import { zCoerceDate } from '../shared/Date.schema'

// A single sourced finding. sourced-or-silent is carried in the type: every
// finding MUST have a non-empty sourceUrl and sourceExtract — there is no such
// thing as an unsourced finding. (Residency/dataset findings store a stable
// voter-file dataset reference in sourceUrl rather than a fetchable URL.)
// sourceReachableAt is null when the source was not network-verified (e.g.
// dataset references); a timestamp means the URL was confirmed reachable at
// persist. draftedResponse is self-research only.
export const RaceOpponentFindingSchema = z.object({
  id: z.number(),
  researchId: z.number(),
  claim: z.string(),
  sourceUrl: z.string().min(1),
  sourceExtract: z.string().min(1),
  sourceTitle: z.string().nullable(),
  sourceReachableAt: zCoerceDate().nullable(),
  category: z.string(),
  occurredAt: zCoerceDate().nullable(),
  draftedResponse: z.string().nullable(),
  createdAt: zCoerceDate(),
})
export type RaceOpponentFinding = z.infer<typeof RaceOpponentFindingSchema>
