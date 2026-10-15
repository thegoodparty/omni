import { Module } from '@nestjs/common'
import { ConstituentFeedbackModule } from '@/constituentFeedback/constituentFeedback.module'
import { ContactInteractionModule } from '@/contactInteraction/contactInteraction.module'
import { ContactsModule } from '@/contacts/contacts.module'
import { PhoneBankingModule } from '@/phoneBanking/phoneBanking.module'
import { ActivitySeedService } from './services/activitySeed.service'

@Module({
  imports: [
    ConstituentFeedbackModule,
    ContactInteractionModule,
    ContactsModule,
    PhoneBankingModule,
  ],
  providers: [ActivitySeedService],
  exports: [ActivitySeedService],
})
export class ActivitySeedModule {}
