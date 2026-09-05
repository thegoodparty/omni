import { Module } from '@nestjs/common'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { ContactsModule } from '@/contacts/contacts.module'
import { ContactInteractionModule } from '@/contactInteraction/contactInteraction.module'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { OutreachModule } from '@/outreach/outreach.module'
import { PeopleQueryModule } from '@/peopleDb/peopleQuery.module'
import { PhoneBankingController } from './phoneBanking.controller'
import { PhoneBankingAccessService } from './services/phoneBankingAccess.service'
import { PhoneBankingCallService } from './services/phoneBankingCall.service'
import { PhoneBankingListService } from './services/phoneBankingList.service'

@Module({
  imports: [
    ClerkModule,
    ContactsModule,
    ContactInteractionModule,
    ElectedOfficeModule,
    OrganizationsModule,
    // For OutreachAssignmentService — nothing in OutreachModule's own import
    // graph reaches back to PhoneBankingModule, so no forwardRef is needed
    // here (unlike the cycles OutreachModule itself defers internally).
    OutreachModule,
    PeopleQueryModule,
  ],
  controllers: [PhoneBankingController],
  providers: [
    PhoneBankingListService,
    PhoneBankingCallService,
    PhoneBankingAccessService,
  ],
})
export class PhoneBankingModule {}
