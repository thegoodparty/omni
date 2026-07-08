import { z } from 'zod'
import { zCoerceDate } from '../shared/Date.schema'
import {
  RaceOpponentResearchStatusSchema,
  RaceOpponentContrastStatusSchema,
  RaceOpponentFindingKindSchema,
} from '../generated/enums'

// Re-export the Prisma-generated enums (research status, contrast status,
// finding kind) from the domain barrel so consumers import them alongside the
// entity shapes rather than reaching into ../generated.
export {
  RaceOpponentResearchStatusSchema,
  RaceOpponentContrastStatusSchema,
  RaceOpponentFindingKindSchema,
  type RaceOpponentResearchStatus,
  type RaceOpponentContrastStatus,
  type RaceOpponentFindingKind,
  RACE_OPPONENT_RESEARCH_STATUS_VALUES,
  RACE_OPPONENT_CONTRAST_STATUS_VALUES,
  RACE_OPPONENT_FINDING_KIND_VALUES,
} from '../generated/enums'

// A research run for one side of the race: `kind=self` is the candidate's own
// record (drafted responses allowed); `kind=opponent` targets a named opponent.
// opponentName/electionCandidacyId are null for self-research.
export const RaceOpponentResearchSchema = z.object({
  id: z.number(),
  kind: RaceOpponentFindingKindSchema,
  opponentName: z.string().nullable(),
  electionCandidacyId: z.string().nullable(),
  status: RaceOpponentResearchStatusSchema,
  runId: z.string().nullable(),
  attempts: z.number(),
  completedAt: zCoerceDate().nullable(),
  lastViewedAt: zCoerceDate().nullable(),
  createdAt: zCoerceDate(),
  updatedAt: zCoerceDate(),
})
export type RaceOpponentResearch = z.infer<typeof RaceOpponentResearchSchema>
