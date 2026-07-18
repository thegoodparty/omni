import { HttpModule } from '@nestjs/axios'
import { forwardRef, Module } from '@nestjs/common'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { OrganizationsModule } from 'src/organizations/organizations.module'
import { SlackModule } from 'src/vendors/slack/slack.module'
import { ElectedOfficeModule } from '../electedOffice/electedOffice.module'
import { PeerlyModule } from '../vendors/peerly/peerly.module'
import { VoterDatabaseService } from './services/voterDatabase.service'
import { VoterFileFilterService } from './services/voterFileFilter.service'
import { VotersService } from './services/voters.service'
import { VoterFileController } from './voterFile/voterFile.controller'
import { VoterFileService } from './voterFile/voterFile.service'

@Module({
  imports: [
    ClerkModule,
    HttpModule,
    OrganizationsModule,
    // PeerlyModule -> VotersModule (VoterFileFilterService) closes a cycle
    // with this import; both edges need forwardRef
    forwardRef(() => PeerlyModule),
    SlackModule,
    ElectedOfficeModule,
  ],
  controllers: [VoterFileController],
  providers: [
    VoterFileService,
    VoterDatabaseService,
    VotersService,
    VoterFileFilterService,
  ],
  exports: [
    VoterFileService,
    VotersService,
    VoterFileFilterService,
    VoterDatabaseService,
  ],
})
export class VotersModule {}
