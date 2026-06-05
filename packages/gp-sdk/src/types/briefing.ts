export type BriefingAdminDateRange =
  | 'All time'
  | 'last 12 months'
  | 'last 30 days'
  | 'last week'

export type BriefingAdminListQuery = {
  offset?: number
  limit?: number
  q?: string
  dateRange?: BriefingAdminDateRange
}

export type BriefingAdminRow = {
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
}
