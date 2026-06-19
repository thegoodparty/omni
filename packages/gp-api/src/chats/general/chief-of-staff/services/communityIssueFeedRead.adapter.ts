import { Injectable } from '@nestjs/common'
import { CommunityIssueFeedReadService } from '@/communityIssueFeed/services/communityIssueFeedRead.service'
import type {
  CommunityIssueFeedDetail,
  CommunityIssueFeedReadPort,
} from './communityIssueFeedRead.port'

@Injectable()
export class CommunityIssueFeedReadAdapter implements CommunityIssueFeedReadPort {
  constructor(private readonly service: CommunityIssueFeedReadService) {}

  getDetail(
    id: string,
    organizationSlug: string,
    electedOfficeId: string,
  ): Promise<CommunityIssueFeedDetail> {
    return this.service.getDetailForOrg(id, organizationSlug, electedOfficeId)
  }
}
