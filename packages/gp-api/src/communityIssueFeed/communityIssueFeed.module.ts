import { Module } from '@nestjs/common'
import { AgentExperimentsModule } from '@/agentExperiments/agentExperiments.module'
import { CronModule } from '@/cron/cron.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { AwsModule } from '@/vendors/aws/aws.module'
import { CommunityIssueFeedService } from './services/communityIssueFeed.service'
import { CommunityIssueFeedDispatchService } from './services/communityIssueFeedDispatch.service'
import { CommunityIssueFeedUpsertService } from './services/communityIssueFeedUpsert.service'

@Module({
  imports: [AgentExperimentsModule, AwsModule, CronModule, OrganizationsModule],
  providers: [
    CommunityIssueFeedService,
    CommunityIssueFeedDispatchService,
    CommunityIssueFeedUpsertService,
  ],
  exports: [CommunityIssueFeedService, CommunityIssueFeedDispatchService],
})
export class CommunityIssueFeedModule {}
