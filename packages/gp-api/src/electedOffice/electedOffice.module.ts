import { CommunityIssuesModule } from '@/communityIssues/communityIssues.module'
import { OrdinancesModule } from '@/ordinances/ordinances.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { MeetingsModule } from '@/meetings/meetings.module'
import { PrioritiesModule } from '@/priorities/priorities.module'
import { ElectionsModule } from '@/elections/elections.module'
import { MagicLinkModule } from '@/magicLink/magicLink.module'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { HttpModule } from '@nestjs/axios'
import { Module, forwardRef } from '@nestjs/common'
import { ElectedOfficeController } from './electedOffice.controller'
import { UseElectedOfficeGuard } from './guards/UseElectedOffice.guard'
import { UserOrM2MGuard } from './guards/UserOrM2M.guard'
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
    MagicLinkModule,
    HttpModule,
    ClerkModule,
  ],
  controllers: [ElectedOfficeController],
  providers: [
    ElectedOfficeService,
    SupportEstimateService,
    ElectedOfficeSupportApiService,
    UseElectedOfficeGuard,
    UserOrM2MGuard,
  ],
  exports: [ElectedOfficeService, UseElectedOfficeGuard],
})
export class ElectedOfficeModule {}
