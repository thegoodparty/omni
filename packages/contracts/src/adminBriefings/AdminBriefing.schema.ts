import { z } from 'zod'
import { zCoerceDate } from '../shared/Date.schema'
import { PaginationOptionsSchema } from '../shared/Pagination.schema'
import { ArtifactReviewSchema } from '../artifactReview/ArtifactReview.schema'

// Mirrors the gp-api admin user-list DateRangeFilter values. Duplicated here
// (not imported) because contracts cannot depend on gp-api src, and this filter
// now crosses the boundary into gp-admin's table UI. Filters on meeting_date.
export const BRIEFING_DATE_RANGE_VALUES = [
  'All time',
  'last 12 months',
  'last 30 days',
  'last week',
] as const
export const BriefingDateRangeFilterSchema = z.enum(BRIEFING_DATE_RANGE_VALUES)
export type BriefingDateRangeFilter = z.infer<
  typeof BriefingDateRangeFilterSchema
>

// 'pending' is the absence of an ArtifactReview row, not a stored value.
export const BRIEFING_REVIEW_STATUS_VALUES = [
  'pending',
  'passed',
  'failed',
] as const
export const BriefingReviewStatusFilterSchema = z.enum(
  BRIEFING_REVIEW_STATUS_VALUES,
)
export type BriefingReviewStatusFilter = z.infer<
  typeof BriefingReviewStatusFilterSchema
>

export const BriefingAdminListQuerySchema = PaginationOptionsSchema.extend({
  // Fuzzy match across the owning user's first name, last name, and email.
  q: z.string().optional(),
  dateRange: BriefingDateRangeFilterSchema.optional(),
  reviewStatus: BriefingReviewStatusFilterSchema.optional(),
})
export type BriefingAdminListQuery = z.infer<
  typeof BriefingAdminListQuerySchema
>

// The elected office has no name/type columns of its own — it is identified by
// its organization slug and the org's custom position name (when set).
export const BriefingAdminRowSchema = z.object({
  briefingId: z.string(),
  // The gp-webapp briefing route slug is the meeting date (YYYY-MM-DD).
  meetingDate: z.string(),
  // Read from the briefing artifact JSON; absent until a briefing is produced.
  meetingName: z.string().nullable(),
  user: z.object({
    id: z.number().int(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    email: z.string(),
  }),
  electedOffice: z.object({
    id: z.string(),
    organizationSlug: z.string(),
    positionName: z.string().nullable(),
  }),
  updatedAt: zCoerceDate(),
  review: ArtifactReviewSchema.nullable(),
})
export type BriefingAdminRow = z.infer<typeof BriefingAdminRowSchema>
