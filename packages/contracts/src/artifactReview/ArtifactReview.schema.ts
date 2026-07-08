import { z } from 'zod'
import { zCoerceDate } from '../shared/Date.schema'
import { ArtifactReviewVerdictSchema } from '../generated/enums'

// Current pass/fail verdict on a reviewable artifact (briefings today).
// reviewedAt is the row's updatedAt — verdicts are last-write-wins.
export const ArtifactReviewSchema = z.object({
  verdict: ArtifactReviewVerdictSchema,
  failReason: z.string().nullable(),
  reviewerEmail: z.string().nullable(),
  reviewedAt: zCoerceDate(),
})
export type ArtifactReview = z.infer<typeof ArtifactReviewSchema>

export const SetArtifactReviewVerdictRequestSchema = z.object({
  verdict: ArtifactReviewVerdictSchema,
  // Optional here (callers simply omit it) vs nullable on the response,
  // where the DB's nullable column comes back as null.
  failReason: z.string().min(1).max(2000).optional(),
})
export type SetArtifactReviewVerdictRequest = z.infer<
  typeof SetArtifactReviewVerdictRequestSchema
>

export const BriefingReviewLookupResponseSchema = z.object({
  review: ArtifactReviewSchema.nullable(),
})
export type BriefingReviewLookupResponse = z.infer<
  typeof BriefingReviewLookupResponseSchema
>
