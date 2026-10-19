import { Module } from '@nestjs/common'
import { ConstituentFeedbackModule } from '@/constituentFeedback/constituentFeedback.module'
import { ContactInteractionModule } from '@/contactInteraction/contactInteraction.module'
import { ContactsModule } from '@/contacts/contacts.module'
import { OutreachModule } from '@/outreach/outreach.module'
import { PhoneBankingModule } from '@/phoneBanking/phoneBanking.module'
import { PrioritiesModule } from '@/priorities/priorities.module'
import { ActivitySeedService } from './services/activitySeed.service'

@Module({
  imports: [
    ConstituentFeedbackModule,
    ContactInteractionModule,
    ContactsModule,
    OutreachModule,
    PhoneBankingModule,
    PrioritiesModule,
  ],
  providers: [ActivitySeedService],
  exports: [ActivitySeedService],
})
export class ActivitySeedModule {}
