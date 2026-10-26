import { forwardRef, Module } from '@nestjs/common'
import { ContactsModule } from '@/contacts/contacts.module'
import { ElectionsModule } from '@/elections/elections.module'
import { PeopleQueryModule } from '@/peopleDb/peopleQuery.module'
import { StripeModule } from 'src/vendors/stripe/stripe.module'
import { RobocallFreeOfferService } from './services/robocallFreeOffer.service'

// The offer's endpoint lives with recommended lists (it sizes the offer
// list), and OutreachModule reads this service at payment, so this module
// holds only the service both share.
@Module({
  imports: [
    // ContactsModule pulls in CampaignsModule and onward to Peerly, which
    // loops back to Outreach, which imports this module.
    forwardRef(() => ContactsModule),
    ElectionsModule,
    PeopleQueryModule,
    StripeModule,
  ],
  providers: [RobocallFreeOfferService],
  exports: [RobocallFreeOfferService],
})
export class RobocallFreeOfferModule {}
