import { forwardRef, Module } from '@nestjs/common'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { ContactsModule } from 'src/contacts/contacts.module'
import { OrganizationsModule } from 'src/organizations/organizations.module'
import { ElectedOfficeModule } from '../electedOffice/electedOffice.module'
import { PeerlyModule } from '../vendors/peerly/peerly.module'
import { VoterFileFilterService } from './services/voterFileFilter.service'
import { VoterFileFilterGeoService } from './services/voterFileFilterGeo.service'
import { VoterFileFilterSampleService } from './services/voterFileFilterSample.service'
import { VoterFileController } from './voterFile/voterFile.controller'
import { VoterFileService } from './voterFile/voterFile.service'

@Module({
  imports: [
    ClerkModule,
    OrganizationsModule,
    // PeerlyModule -> VotersModule (VoterFileFilterService) closes a cycle
    // with this import; both edges need forwardRef
    forwardRef(() => PeerlyModule),
    // ContactsModule -> VotersModule (VoterFileFilterService) closes a cycle
    // with this import too (VoterFileService rides ContactsService's
    // people-api pipeline, ENG-5032); both edges need forwardRef
    forwardRef(() => ContactsModule),
    ElectedOfficeModule,
  ],
  controllers: [VoterFileController],
  providers: [
    VoterFileService,
    VoterFileFilterService,
    VoterFileFilterGeoService,
    VoterFileFilterSampleService,
  ],
  exports: [
    VoterFileService,
    VoterFileFilterService,
    VoterFileFilterGeoService,
    VoterFileFilterSampleService,
  ],
})
export class VotersModule {}
