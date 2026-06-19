import { CommunityIssueFeedModule } from '@/communityIssueFeed/communityIssueFeed.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { MeetingsModule } from '@/meetings/meetings.module'
import { PrioritiesModule } from '@/priorities/priorities.module'
import { ElectionsModule } from '@/elections/elections.module'
import { Module, forwardRef } from '@nestjs/common'
import { ElectedOfficeController } from './electedOffice.controller'
import { UseElectedOfficeGuard } from './guards/UseElectedOffice.guard'
import { UserOrM2MGuard } from './guards/UserOrM2M.guard'
import { ElectedOfficeService } from './services/electedOffice.service'
import { SupportEstimateService } from './services/supportEstimate.service'

@Module({
  imports: [
    CommunityIssueFeedModule,
    OrganizationsModule,
    forwardRef(() => MeetingsModule),
    forwardRef(() => PrioritiesModule),
    ElectionsModule,
  ],
  controllers: [ElectedOfficeController],
  providers: [
    ElectedOfficeService,
    SupportEstimateService,
    UseElectedOfficeGuard,
    UserOrM2MGuard,
  ],
  exports: [ElectedOfficeService, UseElectedOfficeGuard],
})
export class ElectedOfficeModule {}
