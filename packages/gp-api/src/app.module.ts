import { AgentMcpMarkerModule } from '@/authentication/agentMcpMarker'
import { AgentExperimentsModule } from '@/agentExperiments/agentExperiments.module'
import { BriefingChatsModule } from '@/chats/briefing-chats/briefing-chats.module'
import { McpModule } from '@/mcp/mcp.module'
import { AdminModule } from '@/admin/admin.module'
import { AnalyticsModule } from '@/analytics/analytics.module'
import { AuthenticationModule } from '@/authentication/authentication.module'
import { SessionGuard } from '@/authentication/guards/Session.guard'
import { ImpersonationInterceptor } from '@/analytics/interceptors/Impersonation.interceptor'
import { AdminAuditInterceptor } from '@/authentication/interceptors/AdminAudit.interceptor'
import { CampaignPlanSharesModule } from '@/campaignPlanShares/campaignPlanShares.module'
import { CampaignsModule } from '@/campaigns/campaigns.module'
import { CommunityIssuesModule } from '@/communityIssues/communityIssues.module'
import { ContactEngagementModule } from '@/contactEngagement/contactEngagement.module'
import { ContactsModule } from '@/contacts/contacts.module'
import { ContentModule } from '@/content/content.module'
import { CrmModule } from '@/crm/crmModule'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { ElectionsModule } from '@/elections/elections.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { ErrorLoggerModule } from '@/errorLogger/errorLogger.module'
import { FeaturesModule } from '@/features/features.module'
import { HealthModule } from '@/health/health.module'
import { BlockedStateInterceptor } from '@/observability/blockedState/blockedState.interceptor'
import { OutreachModule } from '@/outreach/outreach.module'
import { VoterOutreachActivityModule } from '@/voterOutreachActivity/voterOutreachActivity.module'
import { OnboardingModule } from '@/onboarding/onboarding.module'
import { PaymentsModule } from '@/payments/payments.module'
import { MeetingsModule } from '@/meetings/meetings.module'
import { DashboardCardsModule } from '@/dashboardCards/dashboardCards.module'
import { AnnotationsModule } from '@/annotations/annotations.module'
import { ArtifactFeedbackModule } from '@/artifactFeedback/artifactFeedback.module'
import { ArtifactReviewModule } from '@/artifactReview/artifactReview.module'
import { PollsModule } from '@/polls/polls.module'
import { PrioritiesModule } from '@/priorities/priorities.module'
import { PersonProfilesModule } from '@/personProfiles/personProfiles.module'
import { PrismaModule } from '@/prisma/prisma.module'
import { QueueConsumerModule } from '@/queue/consumer/queueConsumer.module'
import { ScheduledMessagingModule } from '@/scheduled-messaging/scheduled-messaging.module'
import { SharedModule } from '@/shared/shared.module'
import { SpeechModule } from '@/speech/speech.module'
import { SubscribeModule } from '@/subscribe/subscribe.module'
import { TopIssuesModule } from '@/topIssues/topIssues.module'
import { SessionsService } from '@/users/services/sessions.service'
import { UsersModule } from '@/users/users.module'
import { BraintrustModule } from '@/vendors/braintrust/braintrust.module'
import { ContentfulModule } from '@/vendors/contentful/contentful.module'
import { GeminiModule } from '@/vendors/google/gemini.module'
import { CampaignStrategyModule } from '@/campaignStrategy/campaignStrategy.module'
import { RaceOpponentModule } from '@/raceOpponent/raceOpponent.module'
import { OrdinancesModule } from '@/ordinances/ordinances.module'
import { CampaignStoryModule } from '@/campaignStory/campaignStory.module'
import { EcanvasserIntegrationModule } from '@/vendors/ecanvasserIntegration/ecanvasserIntegration.module'
import { PeerlyModule } from '@/vendors/peerly/peerly.module'
import { SegmentModule } from '@/vendors/segment/segment.module'
import { VotersModule } from '@/voters/voters.module'
import { WebsitesModule } from '@/websites/websites.module'
import { Module } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'
import { loggerModule } from './observability/logging/logger-module'
// Imported last (after all feature modules) so its transitive import chain
// (ElectedOfficeModule -> MeetingsModule/OrganizationsModule) doesn't force
// early ESM evaluation of campaigns/analytics modules, which surfaces a
// circular-dependency "undefined at runtime" error in CampaignsService.
import { GeneralChatsModule } from '@/chats/general/general-chats.module'

@Module({
  imports: [
    loggerModule,
    AgentMcpMarkerModule,
    ScheduleModule.forRoot(),
    BraintrustModule,
    GeminiModule,
    CampaignStrategyModule,
    RaceOpponentModule,
    CampaignStoryModule,
    AnalyticsModule,
    UsersModule,
    FeaturesModule,
    AuthenticationModule,
    ContentModule,
    HealthModule,
    PrismaModule,
    ContentfulModule,
    CampaignsModule,
    ElectionsModule,
    TopIssuesModule,
    AdminModule,
    AgentExperimentsModule,
    McpModule,
    SharedModule,
    PaymentsModule,
    VotersModule,
    ErrorLoggerModule,
    CrmModule,
    SubscribeModule,
    EcanvasserIntegrationModule,
    ScheduledMessagingModule,
    OutreachModule,
    VoterOutreachActivityModule,
    SegmentModule,
    WebsitesModule,
    CommunityIssuesModule,
    OrdinancesModule,
    PeerlyModule,
    ContactsModule,
    ContactEngagementModule,
    PollsModule,
    PrioritiesModule,
    PersonProfilesModule,
    CampaignPlanSharesModule,
    MeetingsModule,
    DashboardCardsModule,
    AnnotationsModule,
    ArtifactFeedbackModule,
    ArtifactReviewModule,
    ElectedOfficeModule,
    OrganizationsModule,
    OnboardingModule,
    SpeechModule,
    BriefingChatsModule,
    GeneralChatsModule,
  ]
    // Today, the QueueConsumerModule can't really work in the unit test environment,
    // because it needs a real SQS queue to work.
    //
    // In the future, we might be able to support testing end-to-end background work
    // with a local mock queue, or https://www.localstack.cloud, or by migrating to a
    // more local-friendly background-work service like e.g. https://www.inngest.com.
    .concat(process.env.NODE_ENV === 'test' ? [] : [QueueConsumerModule]),
  providers: [
    SessionsService,
    {
      provide: APP_GUARD,
      useClass: SessionGuard,
    },
    // TODO: https://goodparty.clickup.com/t/90132012119/ENG-7349
    {
      provide: APP_INTERCEPTOR,
      useClass: ImpersonationInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ImpersonationInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AdminAuditInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: BlockedStateInterceptor,
    },
  ],
})
export class AppModule {}
