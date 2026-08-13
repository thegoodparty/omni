import { Module } from '@nestjs/common'
import { AuthenticationModule } from 'src/authentication/authentication.module'
import { EmailModule } from 'src/email/email.module'
import { OrganizationsModule } from 'src/organizations/organizations.module'
import { SlackModule } from 'src/vendors/slack/slack.module'
import { AwsModule } from 'src/vendors/aws/aws.module'
import { AgentExperimentsModule } from 'src/agentExperiments/agentExperiments.module'
import { ArtifactReviewModule } from 'src/artifactReview/artifactReview.module'
import { ElectedOfficeModule } from 'src/electedOffice/electedOffice.module'
import { ElectionsModule } from 'src/elections/elections.module'
import { MagicLinkModule } from 'src/magicLink/magicLink.module'
import { AdminCampaignsController } from './campaigns/adminCampaigns.controller'
import { AdminCampaignMagicLinkController } from './campaigns/adminCampaignMagicLink.controller'
import { AdminCampaignsService } from './campaigns/adminCampaigns.service'
import { AdminUsersController } from './users/adminUsers.controller'
import { AdminElectedOfficeController } from './electedOffice/adminElectedOffice.controller'
import { AdminAgentRunsController } from './agentRuns/adminAgentRuns.controller'
import { AdminAgentRunsService } from './agentRuns/services/adminAgentRuns.service'
import { AdminBriefingsController } from './briefings/adminBriefings.controller'
import { AdminBriefingsService } from './briefings/services/adminBriefings.service'

@Module({
  imports: [
    EmailModule,
    AuthenticationModule,
    OrganizationsModule,
    SlackModule,
    AwsModule,
    AgentExperimentsModule,
    ArtifactReviewModule,
    ElectedOfficeModule,
    ElectionsModule,
    MagicLinkModule,
  ],
  controllers: [
    AdminCampaignsController,
    AdminCampaignMagicLinkController,
    AdminUsersController,
    AdminElectedOfficeController,
    AdminAgentRunsController,
    AdminBriefingsController,
  ],
  providers: [
    AdminCampaignsService,
    AdminAgentRunsService,
    AdminBriefingsService,
  ],
})
export class AdminModule {}
