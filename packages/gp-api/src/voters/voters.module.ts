import { HttpModule } from '@nestjs/axios'
import { forwardRef, Module } from '@nestjs/common'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { ContactsModule } from 'src/contacts/contacts.module'
import { OrganizationsModule } from 'src/organizations/organizations.module'
import { SlackModule } from 'src/vendors/slack/slack.module'
import { ElectedOfficeModule } from '../electedOffice/electedOffice.module'
import { PeerlyModule } from '../vendors/peerly/peerly.module'
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
    // ContactsModule -> VotersModule (VoterFileFilterService) closes a cycle
    // with this import too (VoterFileService rides ContactsService's
    // people-api pipeline, ENG-5032); both edges need forwardRef
    forwardRef(() => ContactsModule),
    SlackModule,
    ElectedOfficeModule,
  ],
  controllers: [VoterFileController],
  providers: [VoterFileService, VotersService, VoterFileFilterService],
  exports: [VoterFileService, VotersService, VoterFileFilterService],
})
export class VotersModule {}
