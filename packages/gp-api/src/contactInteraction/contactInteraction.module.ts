import { Module } from '@nestjs/common'
import { ActivityConditionResolutionService } from './services/activityConditionResolution.service'
import { ContactInteractionDoorKnockService } from './services/contactInteractionDoorKnock.service'
import { ContactInteractionPhoneBankingService } from './services/contactInteractionPhoneBanking.service'
import { ContactInteractionRobocallService } from './services/contactInteractionRobocall.service'
import { ContactInteractionTextService } from './services/contactInteractionText.service'
import { ContactsMadeResolutionService } from './services/contactsMadeResolution.service'
import { ContactStatusService } from './services/contactStatus.service'
import { SupportStatusService } from './services/supportStatus.service'

@Module({
  providers: [
    ContactInteractionDoorKnockService,
    ContactInteractionTextService,
    ContactInteractionRobocallService,
    ContactInteractionPhoneBankingService,
    SupportStatusService,
    ActivityConditionResolutionService,
    ContactStatusService,
    ContactsMadeResolutionService,
  ],
  exports: [
    ContactInteractionDoorKnockService,
    ContactInteractionTextService,
    ContactInteractionRobocallService,
    ContactInteractionPhoneBankingService,
    SupportStatusService,
    ActivityConditionResolutionService,
    ContactStatusService,
    ContactsMadeResolutionService,
  ],
})
export class ContactInteractionModule {}
