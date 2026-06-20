export interface CommunityIssueFeedDetail {
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

export interface CommunityIssueFeedReadPort {
  getDetail: (
    id: string,
    organizationSlug: string,
    electedOfficeId: string,
  ) => Promise<CommunityIssueFeedDetail>
}

export const COMMUNITY_ISSUE_FEED_READ_PORT =
  'COS_COMMUNITY_ISSUE_FEED_READ_PORT'
