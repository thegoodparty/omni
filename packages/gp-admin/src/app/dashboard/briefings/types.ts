export interface BriefingAdminRow {
  briefingId: string
  meetingDate: string
  meetingName: string | null
  user: {
    id: number
    firstName: string | null
    lastName: string | null
    email: string
  }
  electedOffice: {
    id: string
    organizationSlug: string
    positionName: string | null
  }
  updatedAt: string
  review: {
    verdict: 'passed' | 'failed'
    failReason: string | null
    reviewerEmail: string | null
    reviewedAt: string
  } | null
}

export const DATE_RANGES = [
  'All time',
  'last 12 months',
  'last 30 days',
  'last week',
] as const

export type DateRange = (typeof DATE_RANGES)[number]

export function isDateRange(value: string): value is DateRange {
  return (DATE_RANGES as readonly string[]).includes(value)
}

export const REVIEW_STATUSES = ['pending', 'passed', 'failed'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

export function isReviewStatus(value: string): value is ReviewStatus {
  return (REVIEW_STATUSES as readonly string[]).includes(value)
}

export interface ListBriefingsParams {
  offset?: number
  limit?: number
  q?: string
  dateRange?: DateRange
  reviewStatus?: ReviewStatus
}

export interface ListBriefingsResult {
  data: BriefingAdminRow[]
  meta: {
    total: number
    offset: number
    limit: number
  }
}

export const SEARCH_PARAMS = {
  PAGE: 'page',
  QUERY: 'q',
  DATE_RANGE: 'dateRange',
  REVIEW_STATUS: 'reviewStatus',
} as const

export const DEFAULT_PER_PAGE = 20
