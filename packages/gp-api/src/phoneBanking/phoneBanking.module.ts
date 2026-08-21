import { Module } from '@nestjs/common'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { ContactsModule } from '@/contacts/contacts.module'
import { ContactInteractionModule } from '@/contactInteraction/contactInteraction.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { PeopleQueryModule } from '@/peopleDb/peopleQuery.module'
import { PhoneBankingController } from './phoneBanking.controller'
import { PhoneBankingCallService } from './services/phoneBankingCall.service'
import { PhoneBankingListService } from './services/phoneBankingList.service'

@Module({
  imports: [
    ClerkModule,
    ContactsModule,
    ContactInteractionModule,
    OrganizationsModule,
    PeopleQueryModule,
  ],
  controllers: [PhoneBankingController],
  providers: [PhoneBankingListService, PhoneBankingCallService],
})
export class PhoneBankingModule {}
