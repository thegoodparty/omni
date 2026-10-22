import { Module } from '@nestjs/common'
import { ConstituentFeedbackModule } from '@/constituentFeedback/constituentFeedback.module'
import { ContactInteractionModule } from '@/contactInteraction/contactInteraction.module'
import { ContactsModule } from '@/contacts/contacts.module'
import { OutreachModule } from '@/outreach/outreach.module'
import { PeopleQueryModule } from '@/peopleDb/peopleQuery.module'
import { PhoneBankingModule } from '@/phoneBanking/phoneBanking.module'
import { CensusCompositionModule } from '@/priorities/censusComposition.module'
import { PrioritiesModule } from '@/priorities/priorities.module'
import { ActivitySeedService } from './services/activitySeed.service'

@Module({
  imports: [
    CensusCompositionModule,
    ConstituentFeedbackModule,
    ContactInteractionModule,
    ContactsModule,
    OutreachModule,
    PeopleQueryModule,
    PhoneBankingModule,
    PrioritiesModule,
  ],
  providers: [ActivitySeedService],
  exports: [ActivitySeedService],
})
export class ActivitySeedModule {}
