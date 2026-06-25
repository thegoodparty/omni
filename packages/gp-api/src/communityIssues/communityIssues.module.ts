import { Module, forwardRef } from '@nestjs/common'
import { AgentExperimentsModule } from '@/agentExperiments/agentExperiments.module'
import { CronModule } from '@/cron/cron.module'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { AwsModule } from '@/vendors/aws/aws.module'
import { CommunityIssuesController } from './controllers/communityIssues.controller'
import { CommunityIssueService } from './services/communityIssue.service'
import { CommunityIssueDispatchService } from './services/communityIssueDispatch.service'
import { CommunityIssuePrioritizeService } from './services/communityIssuePrioritize.service'
import { CommunityIssueReadService } from './services/communityIssueRead.service'
import { CommunityIssueUpsertService } from './services/communityIssueUpsert.service'

@Module({
  imports: [
    AgentExperimentsModule,
    AwsModule,
    CronModule,
    forwardRef(() => ElectedOfficeModule),
    OrganizationsModule,
  ],
  controllers: [CommunityIssuesController],
  providers: [
    CommunityIssueService,
    CommunityIssueDispatchService,
    CommunityIssuePrioritizeService,
    CommunityIssueReadService,
    CommunityIssueUpsertService,
  ],
  exports: [
    CommunityIssueService,
    CommunityIssueDispatchService,
    CommunityIssueReadService,
  ],
})
export class CommunityIssuesModule {}
