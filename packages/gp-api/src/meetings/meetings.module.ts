import { Module, forwardRef } from '@nestjs/common'
import { AgentExperimentsModule } from '@/agentExperiments/agentExperiments.module'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { ElectionsModule } from '@/elections/elections.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { AwsModule } from '@/vendors/aws/aws.module'
import { LlmModule } from '@/llm/llm.module'
import { CronModule } from '@/cron/cron.module'
import { DashboardCardsModule } from '@/dashboardCards/dashboardCards.module'
import { BriefingsPdfController } from './controllers/briefingsPdf.controller'
import { BriefingsPdfRateLimitGuard } from './controllers/briefingsPdfRateLimit.guard'
import { MeetingsBriefingsController } from './controllers/meetingsBriefings.controller'
import { BriefingItemLinksService } from './services/briefingItemLinks.service'
import { BriefingPdfService } from './services/briefingPdf.service'
import { MeetingBriefingsService } from './services/meetingBriefings.service'
import { UserAgendaUploadService } from './services/userAgendaUpload.service'

@Module({
  imports: [
    AgentExperimentsModule,
    forwardRef(() => ElectedOfficeModule),
    ElectionsModule,
    OrganizationsModule,
    AwsModule,
    LlmModule,
    CronModule,
    DashboardCardsModule,
  ],
  controllers: [MeetingsBriefingsController, BriefingsPdfController],
  providers: [
    BriefingItemLinksService,
    MeetingBriefingsService,
    UserAgendaUploadService,
    BriefingPdfService,
    BriefingsPdfRateLimitGuard,
  ],
  exports: [MeetingBriefingsService, UserAgendaUploadService],
})
export class MeetingsModule {}
