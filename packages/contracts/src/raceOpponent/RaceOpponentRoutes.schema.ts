import { z } from 'zod'
import { ArtifactReviewVerdictSchema } from '../generated/enums'
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

// --- Activity stream ("what's new") ---

// One activity item: an opponent finding flagged with whether it landed after
// the candidate last viewed the stream. The stream is ordered by when the
// finding occurred (then when it was persisted), so the client renders a
// chronological "what's new" feed.
export const RaceOpponentActivityItemSchema = RaceOpponentFindingSchema.extend({
  newSinceLastVisit: z.boolean(),
})
export type RaceOpponentActivityItem = z.infer<
  typeof RaceOpponentActivityItemSchema
>

// Mirrors the community-issues feed envelope exactly so the gp-webapp
// IssueFeedList (ENG-10574) can render both feeds from one component: a
// findings array plus a `refresh` block carrying the latest scheduled-research
// run status and the last successful completion time.
//
// `researchStatus` is the authoritative lifecycle of the campaign's opponent
// research, read from the persisted RaceOpponentResearch(kind=opponent) row
// (not_started when no row exists). The UI drives its initial view off this:
// `refresh.status` is ExperimentRun-derived and reports 'running' both for an
// in-flight run AND when no run exists, so it cannot tell "research exists" from
// "no research yet" — researchStatus can.
export const RaceOpponentActivityResponseSchema = z.object({
  findings: z.array(RaceOpponentActivityItemSchema),
  researchStatus: RaceOpponentResearchStatusSchema,
  refresh: z.object({
    status: z.enum(['running', 'completed', 'failed']),
    lastCompletedAt: z.string().nullable(),
  }),
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

// Only the candidate-authored fields are editable. opponentFact, sourceUrl,
// issueTag, and routing are sourced/derived from the opponent finding and stay
// immutable: rewriting opponentFact would silently diverge the displayed fact
// from its citation (sourceUrl), breaking sourced-or-silent. The refine rejects
// an empty PATCH {} so a no-op edit can't bump editCount or fire the event.
export const EditContrastRequestSchema = z
  .object({
    candidateFact: z.string().min(1).optional(),
    contrastSentence: z.string().min(1).optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'At least one field must be provided',
  })
export type EditContrastRequest = z.infer<typeof EditContrastRequestSchema>

// Where an approved contrast is routed as a draft. `story` writes the contrast
// into the Campaign Story narrative; `texting` writes it as a pre-send draft
// Outreach. Neither sends — the candidate's own later action does that.
export const ROUTE_CONTRAST_TARGET_VALUES = ['story', 'texting'] as const
export const RouteContrastTargetSchema = z.enum(ROUTE_CONTRAST_TARGET_VALUES)
export type RouteContrastTarget = z.infer<typeof RouteContrastTargetSchema>

export const RouteContrastRequestSchema = z.object({
  target: RouteContrastTargetSchema,
})
export type RouteContrastRequest = z.infer<typeof RouteContrastRequestSchema>

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

// The route endpoint returns one of the two channel-specific shapes depending
// on the target: a story route carries routedStoryId, a texting route carries
// routedOutreachId.
export const RouteContrastResponseSchema = z.union([
  RouteContrastToStoryResponseSchema,
  RouteContrastToTextingResponseSchema,
])
export type RouteContrastResponse = z.infer<typeof RouteContrastResponseSchema>

export const ContrastResponseSchema = z.object({
  contrast: RaceOpponentContrastSchema,
})
export type ContrastResponse = z.infer<typeof ContrastResponseSchema>

// Generate pairs every eligible opponent finding with the candidate's matching
// position and drafts a contrast for each. Clean drafts come back cleared;
// near-the-line drafts are routed to the fair-line review gate and are NOT
// included here (they surface only after a reviewer clears them). The two
// counts let the page report "N drafted, M sent for review" without a second
// fetch.
export const GenerateContrastsResponseSchema = z.object({
  contrasts: z.array(RaceOpponentContrastSchema),
  routedToReviewCount: z.number(),
})
export type GenerateContrastsResponse = z.infer<
  typeof GenerateContrastsResponseSchema
>

// The candidate read path: cleared/approved/used contrasts only. Anything in
// pending_review or blocked is invisible here until a verdict clears it.
export const ListContrastsResponseSchema = z.object({
  contrasts: z.array(RaceOpponentContrastSchema),
})
export type ListContrastsResponse = z.infer<typeof ListContrastsResponseSchema>
