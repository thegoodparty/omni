import { CommunityIssuesModule } from '@/communityIssues/communityIssues.module'
import { CrmModule } from '@/crm/crmModule'
import { OrdinancesModule } from '@/ordinances/ordinances.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { MeetingsModule } from '@/meetings/meetings.module'
import { PrioritiesModule } from '@/priorities/priorities.module'
import { ElectionsModule } from '@/elections/elections.module'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { SlackModule } from '@/vendors/slack/slack.module'
import { HttpModule } from '@nestjs/axios'
import { Module, forwardRef } from '@nestjs/common'
import { ElectedOfficeController } from './electedOffice.controller'
import { UseElectedOfficeGuard } from './guards/UseElectedOffice.guard'
import { UserOrM2MGuard } from './guards/UserOrM2M.guard'
import { CrmOfficeHolderService } from './services/crmOfficeHolder.service'
import { ElectedOfficeService } from './services/electedOffice.service'
import { SupportEstimateService } from './services/supportEstimate.service'
import { ElectedOfficeSupportApiService } from './services/electedOfficeSupportApi.service'

@Module({
  imports: [
    CommunityIssuesModule,
    forwardRef(() => OrdinancesModule),
    OrganizationsModule,
    forwardRef(() => MeetingsModule),
    forwardRef(() => PrioritiesModule),
    ElectionsModule,
    HttpModule,
    ClerkModule,
    CrmModule,
    SlackModule,
  ],
  controllers: [ElectedOfficeController],
  providers: [
    ElectedOfficeService,
    CrmOfficeHolderService,
    SupportEstimateService,
    ElectedOfficeSupportApiService,
    UseElectedOfficeGuard,
    UserOrM2MGuard,
  ],
  exports: [ElectedOfficeService, UseElectedOfficeGuard],
})
export class ElectedOfficeModule {}
