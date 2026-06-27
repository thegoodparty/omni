import { z } from 'zod'
import { ArtifactReviewVerdictSchema } from '../generated/enums'
import { PaginationMetaSchema } from '../shared/Pagination.schema'
import {
  RaceOpponentResearchSchema,
  RaceOpponentResearchStatusSchema,
} from './RaceOpponentResearch.schema'
import { RaceOpponentFindingSchema } from './RaceOpponentFinding.schema'
import {
  RaceOpponentContrastSchema,
  RaceOpponentContrastRoutingSchema,
} from './RaceOpponentContrast.schema'

// Fair-line review verdict for a contrast. Reuses the shared passed/failed
// verdict enum (the same primitive artifactReview uses) so the two review
// surfaces stay aligned; the shape mirrors ArtifactReviewSchema.
export const RaceOpponentReviewSchema = z.object({
  verdict: ArtifactReviewVerdictSchema,
  failReason: z.string().nullable(),
  reviewerEmail: z.string().nullable(),
  reviewedAt: z.coerce.date(),
})
export type RaceOpponentReview = z.infer<typeof RaceOpponentReviewSchema>

// --- Research lifecycle (self + opponent) ---

// Status/report responses carry the research row plus its findings; the report
// view is the same shape once the run has completed.
export const RaceOpponentResearchWithFindingsSchema =
  RaceOpponentResearchSchema.extend({
    findings: z.array(RaceOpponentFindingSchema),
  })
export type RaceOpponentResearchWithFindings = z.infer<
  typeof RaceOpponentResearchWithFindingsSchema
>

export const StartSelfResearchResponseSchema = z.object({
  research: RaceOpponentResearchSchema,
})
export type StartSelfResearchResponse = z.infer<
  typeof StartSelfResearchResponseSchema
>

export const RaceOpponentResearchStatusResponseSchema = z.object({
  status: RaceOpponentResearchStatusSchema,
  research: RaceOpponentResearchSchema.nullable(),
})
export type RaceOpponentResearchStatusResponse = z.infer<
  typeof RaceOpponentResearchStatusResponseSchema
>

export const RaceOpponentReportResponseSchema = z.object({
  research: RaceOpponentResearchWithFindingsSchema,
})
export type RaceOpponentReportResponse = z.infer<
  typeof RaceOpponentReportResponseSchema
>

// --- Opponent identify / research / profile ---

export const IdentifyOpponentsResponseSchema = z.object({
  opponentNames: z.array(z.string()),
})
export type IdentifyOpponentsResponse = z.infer<
  typeof IdentifyOpponentsResponseSchema
>

export const StartOpponentResearchRequestSchema = z.object({
  opponentName: z.string().min(1),
  electionCandidacyId: z.string().nullish(),
})
export type StartOpponentResearchRequest = z.infer<
  typeof StartOpponentResearchRequestSchema
>

export const StartOpponentResearchResponseSchema = z.object({
  research: RaceOpponentResearchSchema,
})
export type StartOpponentResearchResponse = z.infer<
  typeof StartOpponentResearchResponseSchema
>

export const OpponentProfileResponseSchema = z.object({
  research: RaceOpponentResearchWithFindingsSchema,
})
export type OpponentProfileResponse = z.infer<
  typeof OpponentProfileResponseSchema
>

// --- Activity stream (response-side pagination) ---

// The request-side PaginationSchema (offset/limit) is intentionally NOT reused
// for responses; the activity stream returns its own meta via the shared
// response-side PaginationMetaSchema.
export const RaceOpponentActivityResponseSchema = z.object({
  findings: z.array(RaceOpponentFindingSchema),
  meta: PaginationMetaSchema,
})
export type RaceOpponentActivityResponse = z.infer<
  typeof RaceOpponentActivityResponseSchema
>

// --- Contrast create / edit / route ---

export const CreateContrastRequestSchema = z.object({
  findingId: z.number().nullish(),
  opponentFact: z.string().min(1),
  sourceUrl: z.string().min(1),
  candidateFact: z.string().min(1),
  contrastSentence: z.string().min(1),
  issueTag: z.string().min(1),
  routing: RaceOpponentContrastRoutingSchema,
})
export type CreateContrastRequest = z.infer<typeof CreateContrastRequestSchema>

export const EditContrastRequestSchema = z.object({
  opponentFact: z.string().min(1).optional(),
  candidateFact: z.string().min(1).optional(),
  contrastSentence: z.string().min(1).optional(),
  issueTag: z.string().min(1).optional(),
  routing: RaceOpponentContrastRoutingSchema.optional(),
})
export type EditContrastRequest = z.infer<typeof EditContrastRequestSchema>

export const RouteContrastToStoryResponseSchema = z.object({
  contrast: RaceOpponentContrastSchema,
  routedStoryId: z.number(),
})
export type RouteContrastToStoryResponse = z.infer<
  typeof RouteContrastToStoryResponseSchema
>

export const RouteContrastToTextingResponseSchema = z.object({
  contrast: RaceOpponentContrastSchema,
  routedOutreachId: z.number(),
})
export type RouteContrastToTextingResponse = z.infer<
  typeof RouteContrastToTextingResponseSchema
>

export const ContrastResponseSchema = z.object({
  contrast: RaceOpponentContrastSchema,
})
export type ContrastResponse = z.infer<typeof ContrastResponseSchema>
