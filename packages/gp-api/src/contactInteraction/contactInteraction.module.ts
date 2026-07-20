import { Module } from '@nestjs/common'
import { ActivityConditionResolutionService } from './services/activityConditionResolution.service'
import { ContactInteractionDoorKnockService } from './services/contactInteractionDoorKnock.service'
import { ContactInteractionRobocallService } from './services/contactInteractionRobocall.service'
import { ContactInteractionTextService } from './services/contactInteractionText.service'
import { SupportStatusService } from './services/supportStatus.service'

@Module({
  providers: [
    ContactInteractionDoorKnockService,
    ContactInteractionTextService,
    ContactInteractionRobocallService,
    SupportStatusService,
    ActivityConditionResolutionService,
  ],
  exports: [
    ContactInteractionDoorKnockService,
    ContactInteractionTextService,
    ContactInteractionRobocallService,
    SupportStatusService,
    ActivityConditionResolutionService,
  ],
})
export class ContactInteractionModule {}
