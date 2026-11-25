import { Module, forwardRef } from '@nestjs/common'
import { AgentExperimentsModule } from '@/agentExperiments/agentExperiments.module'
import { AgentsModule } from '@/agents/agents.module'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { ElectionsModule } from '@/elections/elections.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { AwsModule } from '@/vendors/aws/aws.module'
import { LlmModule } from '@/llm/llm.module'
import { DashboardCardsModule } from '@/dashboardCards/dashboardCards.module'
import { CrmModule } from '@/crm/crmModule'
import { BriefingsPdfController } from './controllers/briefingsPdf.controller'
import { BriefingsPdfRateLimitGuard } from './controllers/briefingsPdfRateLimit.guard'
import { MeetingsBriefingsController } from './controllers/meetingsBriefings.controller'
import { BriefingItemLinksService } from './services/briefingItemLinks.service'
import { BriefingPdfService } from './services/briefingPdf.service'
import { BriefingSeedService } from './services/briefingSeed.service'
import { MeetingBriefingsService } from './services/meetingBriefings.service'
import { StatedFirstMeetingService } from './services/statedFirstMeeting.service'
import { UserAgendaUploadService } from './services/userAgendaUpload.service'

@Module({
  imports: [
    AgentExperimentsModule,
    AgentsModule,
    forwardRef(() => ElectedOfficeModule),
    ElectionsModule,
    OrganizationsModule,
    AwsModule,
    LlmModule,
    DashboardCardsModule,
    CrmModule,
  ],
  controllers: [MeetingsBriefingsController, BriefingsPdfController],
  providers: [
    BriefingItemLinksService,
    MeetingBriefingsService,
    StatedFirstMeetingService,
    UserAgendaUploadService,
    BriefingPdfService,
    BriefingSeedService,
    BriefingsPdfRateLimitGuard,
  ],
  exports: [MeetingBriefingsService, UserAgendaUploadService],
})
export class MeetingsModule {}
