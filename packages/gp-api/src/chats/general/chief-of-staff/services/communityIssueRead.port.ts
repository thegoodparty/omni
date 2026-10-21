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

export interface CommunityIssueSummary {
  id: string
  list: 'top_community' | 'trending'
  title: string
  summary: string
  category: string
  rank: number | null
  prioritized: boolean
}

export interface CommunityIssueReadPort {
  list: (
    organizationSlug: string,
    electedOfficeId: string,
  ) => Promise<CommunityIssueSummary[]>
  getDetail: (
    id: string,
    organizationSlug: string,
    electedOfficeId: string,
  ) => Promise<CommunityIssueDetail>
}

export const COMMUNITY_ISSUE_READ_PORT = 'COS_COMMUNITY_ISSUE_READ_PORT'
