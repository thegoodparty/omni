import { Module, forwardRef } from '@nestjs/common'
import { AgentExperimentsModule } from '@/agentExperiments/agentExperiments.module'
import { CronModule } from '@/cron/cron.module'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { AwsModule } from '@/vendors/aws/aws.module'
import { CommunityIssueFeedController } from './controllers/communityIssueFeed.controller'
import { CommunityIssueFeedService } from './services/communityIssueFeed.service'
import { CommunityIssueFeedDispatchService } from './services/communityIssueFeedDispatch.service'
import { CommunityIssueFeedPrioritizeService } from './services/communityIssueFeedPrioritize.service'
import { CommunityIssueFeedReadService } from './services/communityIssueFeedRead.service'
import { CommunityIssueFeedUpsertService } from './services/communityIssueFeedUpsert.service'

@Module({
  imports: [
    AgentExperimentsModule,
    AwsModule,
    CronModule,
    forwardRef(() => ElectedOfficeModule),
    OrganizationsModule,
  ],
  controllers: [CommunityIssueFeedController],
  providers: [
    CommunityIssueFeedService,
    CommunityIssueFeedDispatchService,
    CommunityIssueFeedPrioritizeService,
    CommunityIssueFeedReadService,
    CommunityIssueFeedUpsertService,
  ],
  exports: [CommunityIssueFeedService, CommunityIssueFeedDispatchService],
})
export class CommunityIssueFeedModule {}
