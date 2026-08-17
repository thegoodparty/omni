import { OrganizationsModule } from '@/organizations/organizations.module'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { AgentExperimentsModule } from '@/agentExperiments/agentExperiments.module'
import { CronModule } from '@/cron/cron.module'
import { forwardRef, Global, Module } from '@nestjs/common'
import { AwsModule } from 'src/vendors/aws/aws.module'
import { ElectionsModule } from 'src/elections/elections.module'
import { EmailModule } from 'src/email/email.module'
import { UsersModule } from 'src/users/users.module'
import { ContactsModule } from 'src/contacts/contacts.module'
import { SlackModule } from 'src/vendors/slack/slack.module'
import { AnalyticsModule } from '../analytics/analytics.module'
import { CrmModule } from '../crm/crmModule'
import { QueueProducerModule } from '../queue/producer/queueProducer.module'
import { ScheduledMessagingModule } from '../scheduled-messaging/scheduled-messaging.module'
import { EcanvasserIntegrationModule } from '../vendors/ecanvasserIntegration/ecanvasserIntegration.module'
import { GoogleModule } from '../vendors/google/google.module'
import { PeerlyModule } from '../vendors/peerly/peerly.module'
import { StripeModule } from '../vendors/stripe/stripe.module'
import { WebsitesModule } from '../websites/websites.module'
import { CampaignsAiModule } from './ai/campaignsAi.module'
import { CampaignsController } from './campaigns.controller'
import { FilingInstructionsService } from './filingInstructions/filingInstructions.service'
import { CampaignPositionsController } from './positions/campaignPositions.controller'
import { CampaignPositionsService } from './positions/campaignPositions.service'
import { CampaignPlanVersionsService } from './services/campaignPlanVersions.service'
import { CampaignsService } from './services/campaigns.service'
import { CrmCampaignsService } from './services/crmCampaigns.service'
import { EligibilityService } from './services/eligibility.service'
import { CampaignTasksController } from './tasks/campaignTasks.controller'
import { CampaignTasksService } from './tasks/services/campaignTasks.service'
import { CampaignTrackerController } from './campaignTracker/campaignTracker.controller'
import { CampaignTrackerTasksService } from './campaignTracker/services/campaignTrackerTasks.service'
import { CampaignTrackerDispatchService } from './campaignTracker/services/campaignTrackerDispatch.service'
import { AiGenerationService } from './tasks/services/aiGeneration.service'
import { CampaignTcrComplianceController } from './tcrCompliance/campaignTcrCompliance.controller'
import { CampaignTcrComplianceService } from './tcrCompliance/services/campaignTcrCompliance.service'
import { Nightly10DlcReportService } from './tcrCompliance/services/nightly10DlcReport.service'
import { ComplianceStateService } from './tcrCompliance/services/complianceState.service'
import { WeeklyTasksDigestService } from './tasks/services/weeklyTasksDigest.service'
import { WeeklyTasksDigestHandlerService } from './tasks/services/weeklyTasksDigestHandler.service'
import { CampaignUpdateHistoryController } from './updateHistory/campaignUpdateHistory.controller'
import { CampaignUpdateHistoryService } from './updateHistory/campaignUpdateHistory.service'
import { PublicCampaignsController } from './controllers/public-campaigns.controller'
import { EligibilityController } from './controllers/eligibility.controller'
import { PublicCampaignsService } from './services/public-campaigns.service'

@Global()
@Module({
  imports: [
    AwsModule,
    EmailModule,
    CampaignsAiModule,
    ClerkModule,
    CrmModule,
    ElectionsModule,
    OrganizationsModule,
    forwardRef(() => ContactsModule),
    forwardRef(() => EcanvasserIntegrationModule),
    ScheduledMessagingModule,
    StripeModule,
    // PeerlyModule -> ContactsModule -> CampaignsModule -> PeerlyModule:
    // every edge of the cycle needs forwardRef
    forwardRef(() => PeerlyModule),
    GoogleModule,
    AnalyticsModule,
    UsersModule,
    WebsitesModule,
    QueueProducerModule,
    SlackModule,
    AgentExperimentsModule,
    ElectedOfficeModule,
    CronModule,
  ],
  controllers: [
    CampaignsController,
    CampaignPositionsController,
    CampaignUpdateHistoryController,
    CampaignTasksController,
    CampaignTrackerController,
    CampaignTcrComplianceController,
    PublicCampaignsController,
    EligibilityController,
  ],
  providers: [
    CampaignsService,
    FilingInstructionsService,
    CampaignPlanVersionsService,
    CampaignPositionsService,
    CampaignUpdateHistoryService,
    CrmCampaignsService,
    CampaignTasksService,
    CampaignTrackerTasksService,
    CampaignTrackerDispatchService,
    AiGenerationService,
    CampaignTcrComplianceService,
    ComplianceStateService,
    Nightly10DlcReportService,
    WeeklyTasksDigestService,
    WeeklyTasksDigestHandlerService,
    PublicCampaignsService,
    EligibilityService,
  ],
  exports: [
    CampaignsService,
    CampaignUpdateHistoryService,
    CrmCampaignsService,
    CampaignTcrComplianceService,
    CampaignTasksService,
    CampaignTrackerTasksService,
    AiGenerationService,
    WeeklyTasksDigestHandlerService,
    Nightly10DlcReportService,
    EligibilityService,
    ComplianceStateService,
  ],
})
export class CampaignsModule {}
