import { Module } from '@nestjs/common'
import { AwsModule } from '@/vendors/aws/aws.module'
import {
  CommunityIssueFeedService,
} from './services/communityIssueFeed.service'
import {
  CommunityIssueFeedUpsertService,
} from './services/communityIssueFeedUpsert.service'

@Module({
  imports: [AwsModule],
  providers: [CommunityIssueFeedService, CommunityIssueFeedUpsertService],
  exports: [CommunityIssueFeedService],
})
export class CommunityIssueFeedModule {}
