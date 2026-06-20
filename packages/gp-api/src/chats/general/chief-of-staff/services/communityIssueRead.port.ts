export interface CommunityIssueDetail {
  id: string
  title: string
  summary: string
  category: string | null
  priority: string | null
  rank: number | null
  detail: Record<string, unknown> | null
  relatedBriefings: Array<{
    meetingBriefingId: string
    briefingItemId: string
    meetingDate: string
  }>
  prioritized: boolean
  priorityId: string | null
}

export interface CommunityIssueReadPort {
  getDetail: (
    id: string,
    organizationSlug: string,
    electedOfficeId: string,
  ) => Promise<CommunityIssueDetail>
}

export const COMMUNITY_ISSUE_READ_PORT = 'COS_COMMUNITY_ISSUE_READ_PORT'
