import { CommunityIssuesModule } from '@/communityIssues/communityIssues.module'
import { CrmModule } from '@/crm/crmModule'
import { OrdinancesModule } from '@/ordinances/ordinances.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { MeetingsModule } from '@/meetings/meetings.module'
import { PrioritiesModule } from '@/priorities/priorities.module'
import { ElectionsModule } from '@/elections/elections.module'
import { ElectedOfficeSupportModule } from '@/electionDb/electedOfficeSupport/electedOfficeSupport.module'
import { SlackModule } from '@/vendors/slack/slack.module'
import { Module, forwardRef } from '@nestjs/common'
import { ElectedOfficeController } from './electedOffice.controller'
import { UseElectedOfficeGuard } from './guards/UseElectedOffice.guard'
import { UserOrM2MGuard } from './guards/UserOrM2M.guard'
import { CrmOfficeHolderService } from './services/crmOfficeHolder.service'
import { ElectedOfficeService } from './services/electedOffice.service'
import { SupportEstimateService } from './services/supportEstimate.service'
import { WinTermService } from './services/winTerm.service'
import { OfficeHoldersModule } from '@/electionDb/officeHolders/officeHolders.module'

@Module({
  imports: [
    CommunityIssuesModule,
    forwardRef(() => OrdinancesModule),
    OrganizationsModule,
    forwardRef(() => MeetingsModule),
    forwardRef(() => PrioritiesModule),
    ElectionsModule,
    ElectedOfficeSupportModule,
    OfficeHoldersModule,
    CrmModule,
    SlackModule,
  ],
  controllers: [ElectedOfficeController],
  providers: [
    ElectedOfficeService,
    CrmOfficeHolderService,
    SupportEstimateService,
    WinTermService,
    UseElectedOfficeGuard,
    UserOrM2MGuard,
  ],
  exports: [ElectedOfficeService, UseElectedOfficeGuard],
})
export class ElectedOfficeModule {}
