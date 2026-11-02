import { Injectable } from '@nestjs/common'
import { CommunityIssueReadService } from '@/communityIssues/services/communityIssueRead.service'
import type {
  CommunityIssueDetail,
  CommunityIssueReadPort,
  CommunityIssueSummary,
} from './communityIssueRead.port'

@Injectable()
export class CommunityIssueReadAdapter implements CommunityIssueReadPort {
  constructor(private readonly service: CommunityIssueReadService) {}

  async list(
    organizationSlug: string,
    electedOfficeId: string,
  ): Promise<CommunityIssueSummary[]> {
    const [topCommunity, trending] = await Promise.all([
      this.service.listForOrg(
        organizationSlug,
        electedOfficeId,
        'top_community',
      ),
      this.service.listForOrg(organizationSlug, electedOfficeId, 'trending'),
    ])
    return [...topCommunity.issues, ...trending.issues].map((issue) => ({
      id: issue.id,
      list: issue.list,
      title: issue.title,
      summary: issue.summary,
      category: issue.category,
      rank: issue.rank,
      prioritized: issue.prioritized,
    }))
  }

  getDetail(
    id: string,
    organizationSlug: string,
    electedOfficeId: string,
  ): Promise<CommunityIssueDetail> {
    return this.service.getDetailForOrg(id, organizationSlug, electedOfficeId)
  }
}
