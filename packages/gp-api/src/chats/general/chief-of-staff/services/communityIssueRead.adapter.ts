import { Injectable } from '@nestjs/common'
import { CommunityIssueReadService } from '@/communityIssues/services/communityIssueRead.service'
import type {
  CommunityIssueDetail,
  CommunityIssueReadPort,
} from './communityIssueRead.port'

@Injectable()
export class CommunityIssueReadAdapter implements CommunityIssueReadPort {
  constructor(private readonly service: CommunityIssueReadService) {}

  getDetail(
    id: string,
    organizationSlug: string,
    electedOfficeId: string,
  ): Promise<CommunityIssueDetail> {
    return this.service.getDetailForOrg(id, organizationSlug, electedOfficeId)
  }
}
